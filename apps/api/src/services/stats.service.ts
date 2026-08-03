import { eq, gt, sql } from "drizzle-orm";
import type { OverviewStats } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues } from "../db/schema";
import { fillDays } from "../lib/timeseries";
import { listProjects, projectEventsCountSince, projectOpenIssueCount } from "./project.service";

function countEvents(cond: any) {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(events)
      .where(cond)
      .get()?.c ?? 0
  );
}

export function overview(): OverviewStats {
  const now = Date.now();
  const d24 = now - 24 * 3600 * 1000;
  const d7 = now - 7 * 24 * 3600 * 1000;
  const d14 = now - 14 * 24 * 3600 * 1000;

  const openIssues =
    db
      .select({ c: sql<number>`count(*)` })
      .from(issues)
      .where(eq(issues.status, "unresolved"))
      .get()?.c ?? 0;

  const perDay = db
    .select({
      day: sql<string>`date(timestamp / 1000, 'unixepoch')`,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(gt(events.timestamp, d14))
    .groupBy(sql`date(timestamp / 1000, 'unixepoch')`)
    .all();

  const eventsPerDay = fillDays(perDay, now, 14);

  const projects = listProjects().map((p) => ({
    id: p.id,
    name: p.name,
    openIssues: projectOpenIssueCount(p.id),
    events24h: projectEventsCountSince(p.id, d24),
  }));

  return {
    openIssues,
    events24h: countEvents(gt(events.timestamp, d24)),
    events7d: countEvents(gt(events.timestamp, d7)),
    eventsPerDay,
    projects,
  };
}
