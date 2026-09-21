CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'advisor')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  filename TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_campaign
  ON campaigns(active)
  WHERE active = 1;

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  external_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'in_progress', 'completed')),
  assigned_advisor_id INTEGER REFERENCES users(id),
  assigned_at TEXT,
  completed_at TEXT,
  extra_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_campaign_external_id
  ON clients(campaign_id, external_id)
  WHERE external_id IS NOT NULL AND TRIM(external_id) != '';

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

CREATE INDEX IF NOT EXISTS idx_clients_available
  ON clients(id)
  WHERE status = 'available';

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_client_per_advisor
  ON clients(assigned_advisor_id)
  WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS phone_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  source TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'call_back')),
  last_result TEXT,
  notes TEXT,
  last_attempt_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_client ON phone_numbers(client_id);

CREATE TABLE IF NOT EXISTS call_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number_id INTEGER NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
  advisor_id INTEGER NOT NULL REFERENCES users(id),
  result TEXT NOT NULL,
  notes TEXT,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_call_attempts_phone ON call_attempts(phone_number_id);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expired INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
