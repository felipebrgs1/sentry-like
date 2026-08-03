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
`);

// Colunas adicionadas depois do schema inicial — idempotente em DBs existentes
for (const stmt of [
  "ALTER TABLE issues ADD COLUMN environment TEXT",
  "ALTER TABLE events ADD COLUMN environment TEXT",
  "ALTER TABLE issues ADD COLUMN release TEXT",
  "ALTER TABLE events ADD COLUMN release TEXT",
]) {
  try {
    sqlite.exec(stmt);
  } catch {
    // coluna já existe
  }
}

export const db = drizzle(sqlite, { schema });
