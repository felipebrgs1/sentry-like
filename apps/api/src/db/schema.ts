import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull().unique(),
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
    status: text("status", { enum: ["unresolved", "resolved"] })
      .notNull()
      .default("unresolved"),
    firstSeen: integer("first_seen").notNull(),
    lastSeen: integer("last_seen").notNull(),
    eventCount: integer("event_count").notNull().default(0),
  },
  (t) => [uniqueIndex("issues_project_fingerprint").on(t.projectId, t.fingerprint)],
);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

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
    payload: text("payload").notNull(),
  },
  (t) => [
    index("events_project_ts").on(t.projectId, t.timestamp),
    index("events_issue").on(t.issueId),
  ],
);
