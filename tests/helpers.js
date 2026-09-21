import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function sampleCsvPath() {
  return path.join(__dirname, '..', 'sample-clients.csv');
}

export function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'callq-'));
  const { app, db } = createApp({
    dbPath: path.join(dir, 'test.db'),
    sessionSecret: 'test-secret',
    secureCookies: false,
    pruneSessions: false,
    seedAdmin: {
      name: 'Administrator',
      username: 'admin',
      password: 'adminpass1',
    },
  });
  return { app, db, dir };
}

export function startTestServer() {
  const ctx = createTestApp();
  const server = http.createServer(ctx.app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        ...ctx,
        server,
        url: `http://127.0.0.1:${port}`,
        async close() {
          await new Promise((done) => server.close(done));
          ctx.db.close();
          fs.rmSync(ctx.dir, { recursive: true, force: true });
        },
      });
    });
  });
}

export function cookieJar() {
  let cookie = '';
  return {
    header() {
      return cookie ? { cookie } : {};
    },
    save(response) {
      const setCookies = response.headers.getSetCookie?.() || [];
      if (setCookies.length) {
        cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
      }
    },
  };
}

export async function request(baseUrl, jar, pathname, options = {}) {
  const headers = {
    ...jar.header(),
    ...(options.headers || {}),
  };
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body,
    redirect: 'manual',
  });
  jar.save(response);
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { response, data, status: response.status };
}

export async function login(baseUrl, username, password) {
  const jar = cookieJar();
  const result = await request(baseUrl, jar, '/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  return { jar, ...result };
}

export async function importSample(baseUrl, adminJar, csvPath = sampleCsvPath()) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([fs.readFileSync(csvPath)], { type: 'text/csv' }),
    'clients.csv'
  );
  const preview = await request(baseUrl, adminJar, '/api/admin/import/preview', {
    method: 'POST',
    body: form,
  });
  const suggested = preview.data?.suggestedMapping;
  const commit = await request(baseUrl, adminJar, '/api/admin/import/commit', {
    method: 'POST',
    body: {
      mapping: suggested || {
        name: 'name',
        external_id: 'client_id',
        phones: ['phone_1', 'phone_2', 'phone_3'],
        extra: ['email', 'company', 'city'],
      },
    },
  });
  return { preview, commit };
}
