import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadEnvFile } from '../src/load-env.js';

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD before seeding.');
  process.exit(1);
}

const { db } = createApp({
  dbPath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db'),
  sessionSecret: process.env.SESSION_SECRET,
  secureCookies: false,
  pruneSessions: false,
  seedAdmin: {
    name: 'Administrator',
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD,
  },
});

console.log(`Admin user "${process.env.ADMIN_USERNAME || 'admin'}" is ready.`);
db.close();
