import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull().unique(),
  allowedDomains: text("allowed_domains"), // JSON array de domínios permitidos (CORS)
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
    payload: text("payload").notNull(),
  },
  (t) => [
    index("transactions_project_ts").on(t.projectId, t.timestamp),
    index("transactions_name_ts").on(t.name, t.timestamp),
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
