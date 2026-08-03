import type { DrizzleD1Database } from "drizzle-orm/d1";
import { DATABASE_PATH } from "../config";
import * as schema from "./schema";

/**
 * Tipo "assíncrono" (estilo D1). No Bun o driver bun-sqlite é síncrono, mas
 * `await` em valor não-promise é inofensivo — um único código roda nos dois.
 */
export type Db = DrizzleD1Database<typeof schema>;

let instance: Db | null = null;

/**
 * Proxy transparente: os services usam `db` sem saber o driver. O driver é
 * escolhido no bootstrap (index.ts → bun, worker.ts → d1) via setDb().
 */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    if (!instance) throw new Error("db not initialized — call initDb() first");
    const value = (instance as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === "function" ? value.bind(instance) : value;
  },
}) as Db;

export function setDb(d: Db) {
  instance = d;
}

// ------------------------------------------------------------------
// Bootstrap do schema — mesmo SQL para os dois drivers (idempotente).
// No Bun roda via sqlite.exec; no D1 vira um batch de db.run.
// ------------------------------------------------------------------

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS issues (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS issues_project_fingerprint ON issues(project_id, fingerprint)`,
  `CREATE TABLE IF NOT EXISTS saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    filters TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS saved_searches_project ON saved_searches(project_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    issue_id INTEGER REFERENCES issues(id),
    timestamp INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'error',
    message TEXT,
    payload TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS events_project_ts ON events(project_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS events_issue ON events(issue_id)`,
  `CREATE TABLE IF NOT EXISTS sentry_sessions (
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
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    event_id TEXT,
    name TEXT NOT NULL,
    content_type TEXT,
    size INTEGER NOT NULL,
    stored_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS attachments_project ON attachments(project_id)`,
  `CREATE TABLE IF NOT EXISTS user_reports (
    event_id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT,
    email TEXT,
    comments TEXT,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS replays (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    timestamp INTEGER NOT NULL,
    release TEXT,
    environment TEXT,
    kind TEXT NOT NULL,
    stored_path TEXT,
    payload TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS replays_project ON replays(project_id)`,
  `CREATE TABLE IF NOT EXISTS client_reports (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    timestamp INTEGER NOT NULL,
    discarded TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS client_reports_project ON client_reports(project_id)`,
  `CREATE TABLE IF NOT EXISTS transactions (
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
    country TEXT,
    trace_id TEXT,
    span_id TEXT,
    parent_span_id TEXT,
    measurements TEXT,
    payload TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS transactions_project_ts ON transactions(project_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS transactions_name_ts ON transactions(name, timestamp)`,
  `CREATE TABLE IF NOT EXISTS spans (
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
  )`,
  `CREATE INDEX IF NOT EXISTS spans_transaction ON spans(transaction_id)`,
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    webhook_type TEXT NOT NULL DEFAULT 'generic',
    webhook_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_fired_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS alert_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER REFERENCES alert_rules(id),
    project_id INTEGER NOT NULL REFERENCES projects(id),
    issue_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    response TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS alert_logs_project ON alert_logs(project_id, sent_at)`,
  `CREATE INDEX IF NOT EXISTS alert_logs_rule_issue ON alert_logs(rule_id, issue_id)`,
  `CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    commits TEXT,
    deployed_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS releases_project_name ON releases(project_id, name)`,
  `CREATE TABLE IF NOT EXISTS sourcemap_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    release TEXT NOT NULL,
    name TEXT NOT NULL,
    dist TEXT,
    sha1 TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_type TEXT,
    is_sourcemap INTEGER NOT NULL DEFAULT 0,
    stored_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sourcemap_files_project_release_name ON sourcemap_files(project_id, release, name)`,
  `CREATE INDEX IF NOT EXISTS sourcemap_files_project ON sourcemap_files(project_id)`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_owner INTEGER NOT NULL DEFAULT 0,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS org_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
];

// colunas adicionadas depois do schema inicial — idempotente em DBs existentes
const ALTER_STATEMENTS = [
  `ALTER TABLE issues ADD COLUMN environment TEXT`,
  `ALTER TABLE events ADD COLUMN environment TEXT`,
  `ALTER TABLE issues ADD COLUMN release TEXT`,
  `ALTER TABLE events ADD COLUMN release TEXT`,
  `ALTER TABLE projects ADD COLUMN allowed_domains TEXT`,
  `ALTER TABLE issues ADD COLUMN ignored_until INTEGER`,
  `ALTER TABLE issues ADD COLUMN regressed INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE issues ADD COLUMN priority TEXT NOT NULL DEFAULT 'low'`,
  `ALTER TABLE issues ADD COLUMN unread INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE issues ADD COLUMN merged_into INTEGER`,
  `ALTER TABLE issues ADD COLUMN assigned_to TEXT`,
  `ALTER TABLE events ADD COLUMN original_issue_id INTEGER`,
  `CREATE INDEX IF NOT EXISTS events_original_issue ON events(original_issue_id)`,
  `CREATE TABLE IF NOT EXISTS saved_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id), name TEXT NOT NULL, filters TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS saved_searches_project ON saved_searches(project_id)`,
  `ALTER TABLE transactions ADD COLUMN country TEXT`,
  `ALTER TABLE transactions ADD COLUMN user_id TEXT`,
  `CREATE INDEX IF NOT EXISTS transactions_user_ts ON transactions(user_id, timestamp)`,
  `ALTER TABLE projects ADD COLUMN org_id INTEGER`,
  `ALTER TABLE sessions ADD COLUMN user_id INTEGER`,
];

/** Cria o banco (bun:sqlite, VPS) e roda o bootstrap síncrono. */
export async function initBunDb(): Promise<Db> {
  const [{ Database }, { drizzle }] = await Promise.all([
    import("bun:sqlite"),
    import("drizzle-orm/bun-sqlite"),
  ]);
  const sqlite = new Database(DATABASE_PATH, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  for (const stmt of CREATE_STATEMENTS) sqlite.exec(stmt);
  for (const stmt of ALTER_STATEMENTS) {
    try {
      sqlite.exec(stmt);
    } catch {
      // coluna já existe
    }
  }

  const d = drizzle(sqlite, { schema }) as unknown as Db;
  setDb(d);
  return d;
}

/** Cria o banco (D1, Cloudflare) e roda o bootstrap assíncrono. */
export async function initD1Db(binding: unknown): Promise<Db> {
  const { drizzle } = await import("drizzle-orm/d1");
  const d = drizzle(binding as never, { schema }) as unknown as Db;
  setDb(d);

  const raw = binding as {
    prepare?: (sql: string) => { run(): Promise<unknown> };
    exec?: (sql: string) => Promise<unknown>;
  };
  // D1: prepare().run() por statement (exec() do miniflare reclamou de "incomplete input")
  if (raw.prepare) {
    for (const stmt of CREATE_STATEMENTS) {
      try {
        await raw.prepare(stmt).run();
      } catch (e) {
        console.error("[sentrylike] d1 create failed:", String(e).slice(0, 160));
      }
    }
    for (const stmt of ALTER_STATEMENTS) {
      try {
        await raw.prepare(stmt).run();
      } catch (e) {
        console.warn("[sentrylike] d1 alter skipped:", String(e).slice(0, 100));
      }
    }
  }
  return d;
}
