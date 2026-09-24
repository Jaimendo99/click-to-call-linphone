import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INITIAL_CAMPAIGN_NAME = 'Importación inicial';

function tableExists(db, name) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name)
  );
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function ensureCampaignIndexes(db) {
  db.exec('DROP INDEX IF EXISTS idx_clients_external_id');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_campaign_external_id
      ON clients(campaign_id, external_id)
      WHERE external_id IS NOT NULL AND TRIM(external_id) != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_campaign
      ON campaigns(active)
      WHERE active = 1;
  `);
}

function findDuplicateExternalId(db) {
  return db
    .prepare(
      `SELECT external_id
       FROM clients
       WHERE external_id IS NOT NULL AND TRIM(external_id) != ''
       GROUP BY external_id
       HAVING COUNT(*) > 1
       LIMIT 1`
    )
    .get();
}

function backfillMissingCampaigns(db) {
  const missing = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE campaign_id IS NULL').get().n;
  if (!missing) return;

  const txn = db.transaction(() => {
    let campaign = db
      .prepare('SELECT id FROM campaigns WHERE name = ? ORDER BY id ASC LIMIT 1')
      .get(INITIAL_CAMPAIGN_NAME);
    if (!campaign) {
      const active = db.prepare('SELECT id FROM campaigns WHERE active = 1').get();
      const result = db
        .prepare('INSERT INTO campaigns (name, filename, active) VALUES (?, NULL, ?)')
        .run(INITIAL_CAMPAIGN_NAME, active ? 0 : 1);
      campaign = { id: Number(result.lastInsertRowid) };
    }
    db.prepare('UPDATE clients SET campaign_id = ? WHERE campaign_id IS NULL').run(campaign.id);
  });
  txn();
}

export function migrateDb(db) {
  if (!tableExists(db, 'clients')) return;

  if (!columnExists(db, 'clients', 'campaign_id')) {
    const duplicate = findDuplicateExternalId(db);
    if (duplicate) {
      throw new Error(
        `No se puede migrar: la cuenta ${duplicate.external_id} está repetida`
      );
    }

    const txn = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          filename TEXT,
          active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec('ALTER TABLE clients ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id)');
      const count = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
      if (count > 0) {
        const result = db
          .prepare('INSERT INTO campaigns (name, filename, active) VALUES (?, NULL, 1)')
          .run(INITIAL_CAMPAIGN_NAME);
        db.prepare('UPDATE clients SET campaign_id = ?').run(result.lastInsertRowid);
      }
      ensureCampaignIndexes(db);
    });
    txn();
    return;
  }

  if (!tableExists(db, 'campaigns')) return;
  backfillMissingCampaigns(db);
  ensureCampaignIndexes(db);
}

export function openDb(dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  migrateDb(db);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateDb(db);
  ensurePhoneSource(db);
  ensurePhoneOffering(db);
  return db;
}

function ensurePhoneSource(db) {
  if (!tableExists(db, 'phone_numbers')) return;
  if (columnExists(db, 'phone_numbers', 'source')) return;
  db.exec('ALTER TABLE phone_numbers ADD COLUMN source TEXT');
}

function pipeTokens(raw) {
  return String(raw || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

function phonesForOfferingBackfill(phones, offerings) {
  if (!offerings.length || !phones.length) return [];
  const contacto = phones.filter((phone) => phone.source === 'Contacto');
  if (contacto.length) return contacto;
  if (phones.length === offerings.length + 1) return phones.slice(1);
  if (phones.length === offerings.length) return phones;
  return [];
}

function ensurePhoneOffering(db) {
  if (!tableExists(db, 'phone_numbers')) return;
  if (!columnExists(db, 'phone_numbers', 'offering')) {
    db.exec('ALTER TABLE phone_numbers ADD COLUMN offering TEXT');
  }
  backfillPhoneOfferings(db);
}

function backfillPhoneOfferings(db) {
  if (!tableExists(db, 'clients')) return;

  const clients = db
    .prepare(
      `SELECT id, extra_data
       FROM clients
       WHERE extra_data LIKE '%offering_contacto%'`
    )
    .all();
  if (!clients.length) return;

  const phonesStmt = db.prepare(
    `SELECT id, source, sort_order, offering
     FROM phone_numbers
     WHERE client_id = ?
     ORDER BY sort_order ASC, id ASC`
  );
  const update = db.prepare(
    `UPDATE phone_numbers
     SET offering = ?
     WHERE id = ? AND (offering IS NULL OR TRIM(offering) = '')`
  );

  const txn = db.transaction(() => {
    for (const client of clients) {
      const extra = parseJson(client.extra_data);
      const raw = extra.offering_contacto;
      if (!raw) continue;
      const offerings = pipeTokens(raw);
      const phones = phonesStmt.all(client.id);
      const targets = phonesForOfferingBackfill(phones, offerings);
      if (!targets.length) continue;
      const limit = Math.min(offerings.length, targets.length);
      for (let i = 0; i < limit; i += 1) {
        update.run(offerings[i].slice(0, 200), targets[i].id);
      }
    }
  });
  txn();
}

export function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
