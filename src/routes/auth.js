import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { publicUser } from '../middleware/auth.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

export function validUsername(value) {
  return USERNAME_PATTERN.test(String(value || '').trim());
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

export function createAuthRouter(db) {
  const router = Router();

  router.post('/login', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      res.status(400).json({ error: 'El usuario y la contraseña son obligatorios' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      return;
    }

    if (!user.active) {
      res.status(403).json({ error: 'Esta cuenta está desactivada' });
      return;
    }

    req.session.regenerate((error) => {
      if (error) {
        res.status(500).json({ error: 'No se pudo crear la sesión' });
        return;
      }
      req.session.user = {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
      };
      req.session.save((saveError) => {
        if (saveError) {
          res.status(500).json({ error: 'No se pudo crear la sesión' });
          return;
        }
        res.json({ user: publicUser({ ...user, active: 1 }) });
      });
    });
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });

  return router;
}
