import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DATABASE_PATH } from "../config";
import * as schema from "./schema";

const sqlite = new Database(DATABASE_PATH, { create: true });

sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA synchronous = NORMAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

// Schema management "lite": CREATE IF NOT EXISTS is enough for a young project.
// When the schema matures, swap this for drizzle-kit migrations.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  culprit TEXT,
  level TEXT NOT NULL DEFAULT 'error',
  status TEXT NOT NULL DEFAULT 'unresolved',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS issues_project_fingerprint ON issues(project_id, fingerprint);
CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  filters TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_searches_project ON saved_searches(project_id);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  issue_id INTEGER REFERENCES issues(id),
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'error',
  message TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project_ts ON events(project_id, timestamp);
CREATE INDEX IF NOT EXISTS events_issue ON events(issue_id);
CREATE TABLE IF NOT EXISTS sentry_sessions (
  sid TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  release TEXT,
  environment TEXT,
  started INTEGER,
  timestamp INTEGER,
  duration INTEGER,
  status TEXT,
  errors INTEGER,
  did TEXT,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  event_id TEXT,
  name TEXT NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_project ON attachments(project_id);
CREATE TABLE IF NOT EXISTS user_reports (
  event_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT,
  email TEXT,
  comments TEXT,
  timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS replays (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  timestamp INTEGER NOT NULL,
  release TEXT,
  environment TEXT,
  kind TEXT NOT NULL,
  stored_path TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS replays_project ON replays(project_id);
CREATE TABLE IF NOT EXISTS client_reports (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  timestamp INTEGER NOT NULL,
  discarded TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS client_reports_project ON client_reports(project_id);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  release TEXT,
  environment TEXT,
  platform TEXT,
  browser TEXT,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  measurements TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_project_ts ON transactions(project_id, timestamp);
CREATE INDEX IF NOT EXISTS transactions_name_ts ON transactions(name, timestamp);
CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  project_id INTEGER NOT NULL,
  trace_id TEXT,
  parent_span_id TEXT,
  op TEXT,
  description TEXT,
  start_timestamp INTEGER,
  end_timestamp INTEGER,
  duration INTEGER,
  status TEXT,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS spans_transaction ON spans(transaction_id);
`);

// Colunas adicionadas depois do schema inicial — idempotente em DBs existentes
for (const stmt of [
  "ALTER TABLE issues ADD COLUMN environment TEXT",
  "ALTER TABLE events ADD COLUMN environment TEXT",
  "ALTER TABLE issues ADD COLUMN release TEXT",
  "ALTER TABLE events ADD COLUMN release TEXT",
  "ALTER TABLE projects ADD COLUMN allowed_domains TEXT",
  // Fase 2
  "ALTER TABLE issues ADD COLUMN ignored_until INTEGER",
  "ALTER TABLE issues ADD COLUMN regressed INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE issues ADD COLUMN priority TEXT NOT NULL DEFAULT 'low'",
  "ALTER TABLE issues ADD COLUMN unread INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE issues ADD COLUMN merged_into INTEGER",
  "ALTER TABLE issues ADD COLUMN assigned_to TEXT",
  "ALTER TABLE events ADD COLUMN original_issue_id INTEGER",
  "CREATE INDEX IF NOT EXISTS events_original_issue ON events(original_issue_id)",
  "CREATE TABLE IF NOT EXISTS saved_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id), name TEXT NOT NULL, filters TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS saved_searches_project ON saved_searches(project_id)",
  // Fase 4
  "CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), name TEXT NOT NULL, timestamp INTEGER NOT NULL, duration INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ok', release TEXT, environment TEXT, platform TEXT, browser TEXT, trace_id TEXT, span_id TEXT, parent_span_id TEXT, measurements TEXT, payload TEXT NOT NULL)",
  "ALTER TABLE transactions ADD COLUMN country TEXT",
  "CREATE INDEX IF NOT EXISTS transactions_project_ts ON transactions(project_id, timestamp)",
  "CREATE INDEX IF NOT EXISTS transactions_name_ts ON transactions(name, timestamp)",
  "CREATE TABLE IF NOT EXISTS spans (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id), project_id INTEGER NOT NULL, trace_id TEXT, parent_span_id TEXT, op TEXT, description TEXT, start_timestamp INTEGER, end_timestamp INTEGER, duration INTEGER, status TEXT, payload TEXT)",
  "CREATE INDEX IF NOT EXISTS spans_transaction ON spans(transaction_id)",
]) {
  try {
    sqlite.exec(stmt);
  } catch {
    // coluna já existe
  }
}

export const db = drizzle(sqlite, { schema });
