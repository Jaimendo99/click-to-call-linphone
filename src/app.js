import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import { CALL_RESULTS, SESSION_TTL_MS } from './lib/constants.js';
import { openDb } from './db.js';
import { SqliteSessionStore } from './lib/sqlite-session-store.js';
import { publicUser, requireAuth } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import { createAdvisorRouter } from './routes/advisor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const viewsDir = path.join(__dirname, '..', 'views');

function sendHtml(res, filename) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(viewsDir, filename));
}

export function bootstrapAdmin(db, { username, password, name } = {}) {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  if (existing > 0) return false;
  if (!username || !password) return false;

  db.prepare(
    `INSERT INTO users (name, username, password_hash, role, active)
     VALUES (?, ?, ?, 'admin', 1)`
  ).run(name || 'Administrator', username, bcrypt.hashSync(password, 10));
  return true;
}

export function createApp(options = {}) {
  const dbPath = options.dbPath || path.join(__dirname, '..', 'data', 'app.db');
  const db = options.db || openDb(dbPath);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  const store = new SqliteSessionStore(db);
  app.use(
    session({
      name: 'connect.sid',
      secret: options.sessionSecret || process.env.SESSION_SECRET || 'dev-only-secret',
      resave: false,
      saveUninitialized: false,
      store,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production' && options.secureCookies !== false,
        maxAge: SESSION_TTL_MS,
      },
    })
  );

  if (options.seedAdmin) {
    bootstrapAdmin(db, options.seedAdmin);
  }

  if (options.pruneSessions !== false) {
    setInterval(() => store.prune(), 30 * 60 * 1000).unref();
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/call-results', requireAuth, (_req, res) => {
    res.json({ results: CALL_RESULTS });
  });

  app.use('/auth', createAuthRouter(db));
  app.get('/api/me', requireAuth, (req, res) => {
    const user = db
      .prepare(
        'SELECT id, name, username, role, active, created_at FROM users WHERE id = ?'
      )
      .get(req.session.user.id);
    if (!user || !user.active) {
      req.session.destroy(() => {
        res.status(401).json({ error: 'Debes iniciar sesión' });
      });
      return;
    }
    res.json({ user: publicUser(user) });
  });
  app.use('/api/admin', createAdminRouter(db));
  app.use('/api/advisor', createAdvisorRouter(db));

  app.use('/lib', express.static(path.join(__dirname, 'lib'), {
    maxAge: 0,
    index: false,
  }));
  app.use(express.static(publicDir, { index: false }));

  app.get('/', (req, res) => {
    if (!req.session?.user) {
      res.redirect('/login');
      return;
    }
    res.redirect(req.session.user.role === 'admin' ? '/admin' : '/advisor');
  });

  app.get('/login', (req, res) => {
    if (req.session?.user) {
      res.redirect(req.session.user.role === 'admin' ? '/admin' : '/advisor');
      return;
    }
    sendHtml(res, 'login.html');
  });

  app.get('/admin', (req, res) => {
    if (!req.session?.user) {
      res.redirect('/login');
      return;
    }
    if (req.session.user.role !== 'admin') {
      res.redirect('/advisor');
      return;
    }
    sendHtml(res, 'admin.html');
  });

  app.get('/advisor', (req, res) => {
    if (!req.session?.user) {
      res.redirect('/login');
      return;
    }
    if (req.session.user.role !== 'advisor') {
      res.redirect('/admin');
      return;
    }
    sendHtml(res, 'advisor.html');
  });

  app.use((error, _req, res, _next) => {
    if (error?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'El CSV es demasiado grande (máximo 10 MB)' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Error inesperado del servidor' });
  });

  return { app, db, store };
}
