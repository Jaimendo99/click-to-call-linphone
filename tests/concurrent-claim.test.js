import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { createTestApp, importSample, login, request, startTestServer } from './helpers.js';

const workerPath = fileURLToPath(new URL('./claim-worker.js', import.meta.url));

test('HTTP concurrent claims never assign the same client twice', async () => {
  const ctx = await startTestServer();
  try {
    const admin = await login(ctx.url, 'admin', 'adminpass1');
    await importSample(ctx.url, admin.jar);

    const advisors = [];
    for (let i = 1; i <= 5; i += 1) {
      const username = `adv${i}`;
      await request(ctx.url, admin.jar, '/api/admin/users', {
        method: 'POST',
        body: {
          name: `Advisor ${i}`,
          username,
          password: 'advisorpass1',
          role: 'advisor',
        },
      });
      advisors.push(await login(ctx.url, username, 'advisorpass1'));
    }

    const results = await Promise.all(
      advisors.map((advisor) =>
        request(ctx.url, advisor.jar, '/api/advisor/current-client')
      )
    );

    const ids = results.map((item) => item.data.client?.id).filter(Boolean);
    assert.equal(ids.length, 5);
    assert.equal(new Set(ids).size, 5);

    const summary = await request(ctx.url, admin.jar, '/api/admin/clients/summary');
    assert.equal(summary.data.in_progress, 5);
    assert.equal(summary.data.available, 0);
  } finally {
    await ctx.close();
  }
});

test('SQLite worker connections cannot claim the same client', async () => {
  const { db, dir } = createTestApp();
  const dbPath = path.join(dir, 'test.db');
  const passwordHash = bcrypt.hashSync('advisorpass1', 4);

  const insertUser = db.prepare(
    `INSERT INTO users (name, username, password_hash, role, active)
     VALUES (?, ?, ?, 'advisor', 1)`
  );
  const campaign = db
    .prepare(`INSERT INTO campaigns (name, active) VALUES ('Prueba', 1)`)
    .run();
  const insertClient = db.prepare(
    `INSERT INTO clients (campaign_id, external_id, name, status) VALUES (?, ?, ?, 'available')`
  );
  const insertPhone = db.prepare(
    `INSERT INTO phone_numbers (client_id, number, sort_order) VALUES (?, ?, 1)`
  );

  const advisorIds = [];
  for (let i = 1; i <= 12; i += 1) {
    const result = insertUser.run(`W${i}`, `w${i}`, passwordHash);
    advisorIds.push(Number(result.lastInsertRowid));
  }
  for (let i = 1; i <= 8; i += 1) {
    const result = insertClient.run(campaign.lastInsertRowid, `x${i}`, `Client ${i}`);
    insertPhone.run(result.lastInsertRowid, `+59399000000${i}`);
  }

  db.close();

  const claimed = await Promise.all(
    advisorIds.map(
      (advisorId) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(workerPath, { workerData: { dbPath, advisorId } });
          worker.on('message', resolve);
          worker.on('error', reject);
        })
    )
  );

  const ids = claimed.map((item) => item.id).filter((id) => id != null);
  const errors = claimed.filter((item) => item.error);
  assert.equal(errors.length, 0, errors.map((item) => item.error).join(', '));
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  assert.equal(claimed.filter((item) => item.id == null).length, 4);
});
