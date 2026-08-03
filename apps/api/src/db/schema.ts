import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull().unique(),
  allowedDomains: text("allowed_domains"), // JSON array de domínios permitidos (CORS)
  orgId: integer("org_id"), // Fase 7: organização dona do projeto
  createdAt: integer("created_at").notNull(),
});

// Fase 7 — multi-usuário & organizações
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(), // pbkdf2:<iters>:<salt>:<hash>
  isOwner: integer("is_owner").notNull().default(0), // role global (simplificado)
  totpSecret: text("totp_secret"), // base32
  totpEnabled: integer("totp_enabled").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const orgs = sqliteTable("orgs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const orgMembers = sqliteTable("org_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgs.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull().default("member"), // owner | member
  createdAt: integer("created_at").notNull(),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  token: text("token").notNull().unique(),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
});

export const issues = sqliteTable(
  "issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    culprit: text("culprit"),
    level: text("level").notNull().default("error"),
    status: text("status", { enum: ["unresolved", "resolved", "ignored", "merged"] })
      .notNull()
      .default("unresolved"),
    environment: text("environment"),
    release: text("release"),
    firstSeen: integer("first_seen").notNull(),
    lastSeen: integer("last_seen").notNull(),
    eventCount: integer("event_count").notNull().default(0),
    // Fase 2: janela de ignore, regressão, prioridade, unread, merge, owner
    ignoredUntil: integer("ignored_until"),
    regressed: integer("regressed").notNull().default(0),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("low"),
    unread: integer("unread").notNull().default(1),
    mergedInto: integer("merged_into"),
    assignedTo: text("assigned_to"),
  },
  (t) => [uniqueIndex("issues_project_fingerprint").on(t.projectId, t.fingerprint)],
);

export const savedSearches = sqliteTable("saved_searches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  filters: text("filters").notNull(), // JSON de SavedSearchFilters
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id"), // Fase 7: dono da sessão
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const sentrySessions = sqliteTable("sentry_sessions", {
  sid: text("sid").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  release: text("release"),
  environment: text("environment"),
  started: integer("started"),
  timestamp: integer("timestamp"),
  duration: integer("duration"),
  status: text("status"),
  errors: integer("errors"),
  did: text("did"),
  payload: text("payload").notNull(),
});

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    eventId: text("event_id"),
    name: text("name").notNull(),
    contentType: text("content_type"),
    size: integer("size").notNull(),
    storedPath: text("stored_path").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("attachments_project").on(t.projectId)],
);

export const userReports = sqliteTable("user_reports", {
  eventId: text("event_id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name"),
  email: text("email"),
  comments: text("comments"),
  timestamp: integer("timestamp").notNull(),
});

export const replays = sqliteTable(
  "replays",
  {
    id: text("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    timestamp: integer("timestamp").notNull(),
    release: text("release"),
    environment: text("environment"),
    kind: text("kind").notNull(), // replay_event | replay_recording
    storedPath: text("stored_path"),
    payload: text("payload"),
  },
  (t) => [index("replays_project").on(t.projectId)],
);

export const clientReports = sqliteTable(
  "client_reports",
  {
    id: text("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    timestamp: integer("timestamp").notNull(),
    discarded: text("discarded").notNull(), // JSON array [{reason, category, quantity}]
  },
  (t) => [index("client_reports_project").on(t.projectId)],
);

// Fase 4 — Performance: transactions + spans (JSON, sem ClickHouse)
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(), // event_id sem hífens
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(), // rota / transaction name
    timestamp: integer("timestamp").notNull(), // início (ms)
    duration: integer("duration").notNull(), // ms
    status: text("status").notNull().default("ok"), // ok | error | cancelled | aborted | unknown
    release: text("release"),
    environment: text("environment"),
    platform: text("platform"),
    browser: text("browser"), // contexts.browser name+version
    country: text("country"), // user.geo.country_code
    traceId: text("trace_id"),
    spanId: text("span_id"),
    parentSpanId: text("parent_span_id"),
    measurements: text("measurements"), // JSON de web vitals
    userId: text("user_id"), // user.id do payload — presença aproximada
    payload: text("payload").notNull(),
  },
  (t) => [
    index("transactions_project_ts").on(t.projectId, t.timestamp),
    index("transactions_name_ts").on(t.name, t.timestamp),
    index("transactions_user_ts").on(t.userId, t.timestamp),
  ],
);

export const spans = sqliteTable(
  "spans",
  {
    id: text("id").primaryKey(), // span_id
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    projectId: integer("project_id").notNull(),
    traceId: text("trace_id"),
    parentSpanId: text("parent_span_id"),
    op: text("op"),
    description: text("description"),
    startTimestamp: integer("start_timestamp"), // ms absoluto
    endTimestamp: integer("end_timestamp"),
    duration: integer("duration"), // ms
    status: text("status"),
    payload: text("payload"),
  },
  (t) => [index("spans_transaction").on(t.transactionId)],
);

// Fase 5 — Alertas: regras + histórico de disparos
export const alertRules = sqliteTable("alert_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  type: text("type", {
    enum: [
      "new_issue",
      "regression",
      "frequency_spike",
      "unresolved_age",
      "rate_limit",
      "daily_digest",
    ],
  }).notNull(),
  config: text("config").notNull().default("{}"), // JSON por tipo
  webhookType: text("webhook_type", { enum: ["generic", "slack", "discord"] })
    .notNull()
    .default("generic"),
  webhookUrl: text("webhook_url").notNull(),
  enabled: integer("enabled").notNull().default(1),
  lastFiredAt: integer("last_fired_at"),
  createdAt: integer("created_at").notNull(),
});

export const alertLogs = sqliteTable(
  "alert_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ruleId: integer("rule_id").references(() => alertRules.id),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    issueId: integer("issue_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    sentAt: integer("sent_at").notNull(),
    status: text("status").notNull().default("ok"), // ok | error
    response: text("response"),
  },
  (t) => [
    index("alert_logs_project").on(t.projectId, t.sentAt),
    index("alert_logs_rule_issue").on(t.ruleId, t.issueId),
  ],
);

// Fase 3 — Releases: metadata manual (commits via webhook de deploy)
// As releases em si são auto-descobertas em events/transactions; esta tabela
// só guarda o que o webhook/usuário marca (commits, deployedAt).
export const releases = sqliteTable(
  "releases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    commits: text("commits"), // JSON array de ReleaseCommit
    deployedAt: integer("deployed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("releases_project_name").on(t.projectId, t.name)],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    issueId: integer("issue_id").references(() => issues.id),
    timestamp: integer("timestamp").notNull(),
    level: text("level").notNull().default("error"),
    message: text("message"),
    environment: text("environment"),
    release: text("release"),
    // usada no unmerge: issue original de onde o evento veio antes do merge
    originalIssueId: integer("original_issue_id"),
    payload: text("payload").notNull(),
  },
  (t) => [
    index("events_project_ts").on(t.projectId, t.timestamp),
    index("events_issue").on(t.issueId),
    index("events_original_issue").on(t.originalIssueId),
  ],
);
