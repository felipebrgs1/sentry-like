import { and, gt, isNotNull, sql } from "drizzle-orm";
import type { OverviewStats, TopRoute } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues, transactions } from "../db/schema";
import { fillDays } from "../lib/timeseries";
import { listProjects, projectEventsCountSince, projectOpenIssueCount } from "./project.service";

async function countEvents(cond: any) {
  return (
    (
      await db
        .select({ c: sql<number>`count(*)` })
        .from(events)
        .where(cond)
        .get()
    )?.c ?? 0
  );
}

/** Usuários ativos (presença aproximada: user.id distinto em transações recentes). */
async function countActiveUsers(since: number): Promise<number> {
  return (
    (
      await db
        .select({ c: sql<number>`count(distinct ${transactions.userId})` })
        .from(transactions)
        .where(and(gt(transactions.timestamp, since), isNotNull(transactions.userId)))
        .get()
    )?.c ?? 0
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export async function overview(): Promise<OverviewStats> {
  const now = Date.now();
  const d24 = now - 24 * 3600 * 1000;
  const d7 = now - 7 * 24 * 3600 * 1000;
  const d14 = now - 14 * 24 * 3600 * 1000;

  const openIssues =
    (
      await db
        .select({ c: sql<number>`count(*)` })
        .from(issues)
        .where(
          sql`(status = 'unresolved' OR (status = 'ignored' AND ignored_until IS NOT NULL AND ignored_until < ${now})) AND merged_into IS NULL`,
        )
        .get()
    )?.c ?? 0;

  const perDay = await db
    .select({
      day: sql<string>`date(timestamp / 1000, 'unixepoch')`,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(gt(events.timestamp, d14))
    .groupBy(sql`date(timestamp / 1000, 'unixepoch')`)
    .all();

  const eventsPerDay = fillDays(perDay, now, 14);

  const projects = await listProjects();
  const projectStats = [];
  for (const p of projects) {
    projectStats.push({
      id: p.id,
      name: p.name,
      openIssues: await projectOpenIssueCount(p.id),
      events24h: await projectEventsCountSince(p.id, d24),
    });
  }

  // Performance (Fase 4): transações das últimas 24h + rotas mais lentas
  const txRows = await db
    .select({
      projectId: transactions.projectId,
      name: transactions.name,
      timestamp: transactions.timestamp,
      duration: transactions.duration,
      status: transactions.status,
    })
    .from(transactions)
    .where(gt(transactions.timestamp, d24))
    .all();

  const txDurations = txRows.map((r) => r.duration).toSorted((a, b) => a - b);
  const txErrors = txRows.filter((r) => r.status !== "ok").length;
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  const routeGroups = new Map<
    string,
    { projectId: number; durations: number[]; errors: number; last: number }
  >();
  for (const r of txRows) {
    const key = `${r.projectId}:${r.name}`;
    let g = routeGroups.get(key);
    if (!g) {
      g = { projectId: r.projectId, durations: [], errors: 0, last: r.timestamp };
      routeGroups.set(key, g);
    }
    g.durations.push(r.duration);
    if (r.status !== "ok") g.errors++;
    g.last = Math.max(g.last, r.timestamp);
  }

  const topRoutes: TopRoute[] = [...routeGroups.entries()]
    .map(([key, g]) => {
      const sorted = [...g.durations].toSorted((a, b) => a - b);
      const name = key.split(":")[1] ?? "?";
      return {
        projectId: g.projectId,
        projectName: projectNames.get(g.projectId) ?? `#${g.projectId}`,
        name,
        count: g.durations.length,
        p95: percentile(sorted, 95),
        errorRate: g.errors / g.durations.length,
        lastSeen: g.last,
      };
    })
    .toSorted((a, b) => b.p95 - a.p95)
    .slice(0, 5);

  return {
    openIssues,
    events24h: await countEvents(gt(events.timestamp, d24)),
    events7d: await countEvents(gt(events.timestamp, d7)),
    eventsPerDay,
    projects: projectStats,
    transactions24h: txRows.length,
    txAvg24h: txDurations.length
      ? Math.round(txDurations.reduce((a, b) => a + b, 0) / txDurations.length)
      : 0,
    txP9524h: percentile(txDurations, 95),
    txErrorRate24h: txDurations.length ? txErrors / txDurations.length : 0,
    topRoutes,
    activeUsers: {
      m15: await countActiveUsers(now - 15 * 60_000),
      m60: await countActiveUsers(now - 60 * 60_000),
      h24: await countActiveUsers(d24),
    },
  };
}
