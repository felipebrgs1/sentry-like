import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { CrashFreeRow, DayCrashFree, SessionRow, UserReport } from "@sentrylike/shared";
import { db } from "../db";
import { events, sentrySessions, userReports } from "../db/schema";

/** Crash-free rate por release (sessões da tabela sentry_sessions). */
export async function releaseCrashFree(projectId: number): Promise<CrashFreeRow[]> {
  const rows = await db
    .select({
      release: sentrySessions.release,
      total: sql<number>`count(*)`,
      crashed: sql<number>`sum(case when status in ('crashed','abnormal') then 1 else 0 end)`,
      last: sql<number>`max(coalesce(${sentrySessions.timestamp}, ${sentrySessions.started}, 0))`,
    })
    .from(sentrySessions)
    .where(eq(sentrySessions.projectId, projectId))
    .groupBy(sentrySessions.release)
    .all();

  return rows
    .map((r) => ({
      release: r.release,
      total: r.total,
      crashed: r.crashed ?? 0,
      crashFree: r.total > 0 ? 1 - (r.crashed ?? 0) / r.total : 1,
      lastSeen: r.last > 0 ? r.last : null,
    }))
    .filter((r): r is CrashFreeRow => r.release !== null)
    .toSorted((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

/** Crash-free rate diária (série temporal para o gráfico). */
export async function crashFreeSeries(
  projectId: number,
  release: string | undefined,
  days = 14,
): Promise<DayCrashFree[]> {
  const now = Date.now();
  const since = now - days * 24 * 3600_000;
  const conds = [
    eq(sentrySessions.projectId, projectId),
    gt(sql`coalesce(${sentrySessions.timestamp}, ${sentrySessions.started}, 0)`, since),
  ];
  if (release) conds.push(eq(sentrySessions.release, release));

  const rows = await db
    .select({
      date: sql<string>`date(coalesce(${sentrySessions.timestamp}, ${sentrySessions.started}, 0) / 1000, 'unixepoch')`,
      total: sql<number>`count(*)`,
      crashed: sql<number>`sum(case when status in ('crashed','abnormal') then 1 else 0 end)`,
    })
    .from(sentrySessions)
    .where(and(...conds))
    .groupBy(
      sql`date(coalesce(${sentrySessions.timestamp}, ${sentrySessions.started}, 0) / 1000, 'unixepoch')`,
    )
    .all();

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: DayCrashFree[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now - (days - 1 - i) * 24 * 3600_000);
    const key = d.toISOString().slice(0, 10);
    const r = byDate.get(key);
    const total = r?.total ?? 0;
    const crashed = r?.crashed ?? 0;
    out.push({
      date: key,
      total,
      crashed,
      crashFree: total > 0 ? 1 - crashed / total : 1,
    });
  }
  return out;
}

/** Sessões recentes do projeto. */
export async function listSessions(projectId: number, limit = 20): Promise<SessionRow[]> {
  const rows = await db
    .select({
      sid: sentrySessions.sid,
      release: sentrySessions.release,
      environment: sentrySessions.environment,
      started: sentrySessions.started,
      timestamp: sentrySessions.timestamp,
      duration: sentrySessions.duration,
      status: sentrySessions.status,
      errors: sentrySessions.errors,
      did: sentrySessions.did,
    })
    .from(sentrySessions)
    .where(eq(sentrySessions.projectId, projectId))
    .orderBy(desc(sql`coalesce(${sentrySessions.timestamp}, ${sentrySessions.started}, 0)`))
    .limit(limit)
    .all();
  return rows;
}

// ------------------------------------------------------------------
// User feedback (Fase 6)
// ------------------------------------------------------------------

/** Reports de uma issue (join com os events pelo event_id). */
export async function issueUserReports(issueId: number): Promise<UserReport[]> {
  const rows = await db
    .select({
      eventId: userReports.eventId,
      projectId: userReports.projectId,
      name: userReports.name,
      email: userReports.email,
      comments: userReports.comments,
      timestamp: userReports.timestamp,
    })
    .from(userReports)
    .innerJoin(events, eq(events.id, userReports.eventId))
    .where(eq(events.issueId, issueId))
    .orderBy(desc(userReports.timestamp))
    .all();
  return rows;
}

/** Reports recentes do projeto. */
export async function projectUserReports(projectId: number, limit = 50): Promise<UserReport[]> {
  return db
    .select({
      eventId: userReports.eventId,
      projectId: userReports.projectId,
      name: userReports.name,
      email: userReports.email,
      comments: userReports.comments,
      timestamp: userReports.timestamp,
    })
    .from(userReports)
    .where(eq(userReports.projectId, projectId))
    .orderBy(desc(userReports.timestamp))
    .limit(limit)
    .all();
}
