import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapAdmin, createApp } from './app.js';
import { loadEnvFile } from './load-env.js';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db');

const { app, db } = createApp({
  dbPath,
  sessionSecret: process.env.SESSION_SECRET,
  secureCookies: false,
});

const created = bootstrapAdmin(db, {
  name: 'Administrator',
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD,
});

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-this-to-a-long-random-string') {
  console.warn('Set SESSION_SECRET to a long random value before deploying.');
}

if (created) {
  console.log(`Created initial admin user "${process.env.ADMIN_USERNAME || 'admin'}"`);
} else if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  console.warn(
    'No users exist. Set ADMIN_PASSWORD and restart, or run `npm run seed`.'
  );
}

app.listen(port, () => {
  console.log(`Call queue listening on http://localhost:${port}`);
});
