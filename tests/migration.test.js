import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateDb, openDb } from '../src/db.js';

const schemaV1 = fs.readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8');

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agendial-mig-'));
  return { dir, dbPath: path.join(dir, 'app.db') };
}

test('migrates a production database into the initial campaign', () => {
  const { dir, dbPath } = tempDbPath();
  const legacy = new Database(dbPath);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(schemaV1);

  const advisor = legacy
    .prepare(
      `INSERT INTO users (name, username, password_hash, role, active)
       VALUES ('Maria', 'maria', 'hash', 'advisor', 1)`
    )
    .run();
  legacy
    .prepare(
      `INSERT INTO clients (external_id, name, status, extra_data)
       VALUES ('105', 'John', 'available', '{"city":"Quito"}')`
    )
    .run();
  const inProgress = legacy
    .prepare(
      `INSERT INTO clients (external_id, name, status, assigned_advisor_id, assigned_at, extra_data)
       VALUES ('106', 'Ana', 'in_progress', ?, '2026-01-01 10:00:00', '{}')`
    )
    .run(advisor.lastInsertRowid);
  legacy
    .prepare(
      `INSERT INTO clients (external_id, name, status, completed_at)
       VALUES ('107', 'Pedro', 'completed', '2026-01-02 10:00:00')`
    )
    .run();
  const phone = legacy
    .prepare(
      `INSERT INTO phone_numbers (client_id, number, sort_order, status, last_result)
       VALUES (?, '0991111111', 1, 'completed', 'Contestó')`
    )
    .run(inProgress.lastInsertRowid);
  legacy
    .prepare(
      `INSERT INTO call_attempts (phone_number_id, advisor_id, result, notes)
       VALUES (?, ?, 'Contestó', 'ok')`
    )
    .run(phone.lastInsertRowid, advisor.lastInsertRowid);
  legacy.prepare(`INSERT INTO sessions (sid, sess, expired) VALUES ('abc', '{}', 0)`).run();
  legacy.close();

  const db = openDb(dbPath);
  const campaigns = db.prepare('SELECT name, active FROM campaigns').all();
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].name, 'Importación inicial');
  assert.equal(campaigns[0].active, 1);

  const clients = db
    .prepare(
      `SELECT external_id, name, status, assigned_advisor_id, campaign_id, extra_data, completed_at
       FROM clients
       ORDER BY id`
    )
    .all();
  assert.equal(clients.length, 3);
  assert.deepEqual(
    clients.map((client) => client.status),
    ['available', 'in_progress', 'completed']
  );
  assert.equal(clients[0].extra_data, '{"city":"Quito"}');
  assert.equal(clients[1].assigned_advisor_id, Number(advisor.lastInsertRowid));
  assert.equal(clients[2].completed_at, '2026-01-02 10:00:00');
  assert.equal(new Set(clients.map((client) => client.campaign_id)).size, 1);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM phone_numbers').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM call_attempts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  assert.equal(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_clients_external_id'`).get(),
    undefined
  );

  db.close();
  const again = openDb(dbPath);
  assert.equal(again.prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE name = 'Importación inicial'`).get().n, 1);
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 3);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration stops when an account is duplicated and leaves the database unchanged', () => {
  const { dir, dbPath } = tempDbPath();
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY,
      external_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      assigned_advisor_id INTEGER,
      assigned_at TEXT,
      completed_at TEXT,
      extra_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  legacy.prepare(`INSERT INTO clients (external_id, name) VALUES ('105', 'Uno')`).run();
  legacy.prepare(`INSERT INTO clients (external_id, name) VALUES ('105', 'Dos')`).run();
  legacy.close();

  const db = new Database(dbPath);
  assert.throws(() => migrateDb(db), /repetida/);
  assert.equal(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaigns'`).get(), undefined);
  const columns = db.prepare('PRAGMA table_info(clients)').all().map((column) => column.name);
  assert.equal(columns.includes('campaign_id'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 2);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('adds offering column and backfills from extra_data without losing progress', () => {
  const { dir, dbPath } = tempDbPath();
  const db = openDb(dbPath);
  const campaign = db
    .prepare(`INSERT INTO campaigns (name, filename, active) VALUES ('Base', NULL, 1)`)
    .run();
  const client = db
    .prepare(
      `INSERT INTO clients (campaign_id, external_id, name, status, extra_data)
       VALUES (?, '2001', 'Cliente', 'in_progress', ?)`
    )
    .run(
      campaign.lastInsertRowid,
      JSON.stringify({
        offering_contacto: 'AMIGO_KIT | PLAN BASICO',
      })
    );
  db.prepare(
    `INSERT INTO phone_numbers (client_id, number, source, sort_order, status, last_result)
     VALUES (?, '0991111111', 'CNEL', 1, 'completed', 'Contestó')`
  ).run(client.lastInsertRowid);
  db.prepare(
    `INSERT INTO phone_numbers (client_id, number, source, sort_order, status)
     VALUES (?, '0992222222', 'Contacto', 2, 'pending')`
  ).run(client.lastInsertRowid);
  db.prepare(
    `INSERT INTO phone_numbers (client_id, number, source, sort_order, status)
     VALUES (?, '0993333333', 'Contacto', 3, 'pending')`
  ).run(client.lastInsertRowid);
  db.close();

  const migrated = openDb(dbPath);
  const columns = migrated
    .prepare('PRAGMA table_info(phone_numbers)')
    .all()
    .map((column) => column.name);
  assert.ok(columns.includes('offering'));

  const phones = migrated
    .prepare(
      `SELECT number, source, offering, last_result, status
       FROM phone_numbers
       ORDER BY sort_order`
    )
    .all();
  assert.deepEqual(
    phones.map((phone) => [phone.number, phone.source, phone.offering, phone.last_result]),
    [
      ['0991111111', 'CNEL', null, 'Contestó'],
      ['0992222222', 'Contacto', 'AMIGO_KIT', null],
      ['0993333333', 'Contacto', 'PLAN BASICO', null],
    ]
  );
  assert.equal(
    migrated.prepare(`SELECT status FROM clients WHERE id = ?`).get(client.lastInsertRowid).status,
    'in_progress'
  );

  migrated.close();
  const again = openDb(dbPath);
  assert.equal(
    again.prepare(`SELECT offering FROM phone_numbers WHERE number = '0992222222'`).get().offering,
    'AMIGO_KIT'
  );
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
