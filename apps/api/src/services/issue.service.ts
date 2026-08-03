import { and, desc, eq, exists, gt, like, sql } from "drizzle-orm";
import type { DayCount, EventSummary, Issue, IssueStatus } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues } from "../db/schema";
import { fillDays } from "../lib/timeseries";

const ISSUE_STATUSES = ["unresolved", "resolved", "ignored"] as const;

export function issueStatus(s?: string): (typeof ISSUE_STATUSES)[number] {
  return ISSUE_STATUSES.find((x) => x === s) ?? "unresolved";
}

export interface IssueFilters {
  status?: string;
  q?: string;
  level?: string;
  env?: string;
  release?: string;
}

export function listProjectIssues(projectId: number, f: IssueFilters): Issue[] {
  const conds = [eq(issues.projectId, projectId), eq(issues.status, issueStatus(f.status))];
  if (f.q) conds.push(like(issues.title, `%${f.q.trim()}%`));
  if (f.level) conds.push(eq(issues.level, f.level));
  // issue pode ter eventos de vários ambientes/releases — filtra pelos eventos
  if (f.env) {
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(events)
          .where(and(eq(events.issueId, issues.id), eq(events.environment, f.env))),
      ),
    );
  }
  if (f.release) {
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(events)
          .where(and(eq(events.issueId, issues.id), eq(events.release, f.release))),
      ),
    );
  }
  return db
    .select()
    .from(issues)
    .where(and(...conds))
    .orderBy(desc(issues.lastSeen))
    .limit(200)
    .all();
}

export function recentIssues(status?: string, limit = 10): Issue[] {
  return db
    .select()
    .from(issues)
    .where(eq(issues.status, issueStatus(status)))
    .orderBy(desc(issues.lastSeen))
    .limit(limit)
    .all();
}

export function getIssue(id: number): Issue | undefined {
  return db.select().from(issues).where(eq(issues.id, id)).get();
}

export function updateIssueStatus(id: number, status: IssueStatus) {
  db.update(issues).set({ status }).where(eq(issues.id, id)).run();
}

export function deleteIssue(id: number): boolean {
  const existing = getIssue(id);
  if (!existing) return false;
  db.delete(events).where(eq(events.issueId, id)).run();
  db.delete(issues).where(eq(issues.id, id)).run();
  return true;
}

export function listIssueEvents(id: number): EventSummary[] {
  return db
    .select({
      id: events.id,
      issueId: events.issueId,
      timestamp: events.timestamp,
      level: events.level,
      environment: events.environment,
      release: events.release,
      message: events.message,
    })
    .from(events)
    .where(eq(events.issueId, id))
    .orderBy(desc(events.timestamp))
    .limit(50)
    .all();
}

export function getEvent(id: string): EventSummary & { payload: string } | undefined {
  return db.select().from(events).where(eq(events.id, id)).get();
}

export function issueEventsPerDay(id: number, days = 14): DayCount[] {
  const now = Date.now();
  const since = now - days * 24 * 3600 * 1000;
  const rows = db
    .select({
      day: sql<string>`date(timestamp / 1000, 'unixepoch')`,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(and(eq(events.issueId, id), gt(events.timestamp, since)))
    .groupBy(sql`date(timestamp / 1000, 'unixepoch')`)
    .all();
  return fillDays(rows, now, days);
}
