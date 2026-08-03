import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { Project, ReleaseStat } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues, projects } from "../db/schema";

export function buildDsn(origin: string, publicKey: string, projectId: number): string {
  return `${origin.replace("://", `://${publicKey}@`)}/${projectId}`;
}

export function listProjects(): Project[] {
  return db.select().from(projects).all();
}

export function getProject(id: number): Project | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function createProject(name: string): { id: number; name: string; publicKey: string } {
  const publicKey = crypto.randomUUID().replace(/-/g, "");
  const row = db
    .insert(projects)
    .values({ name, publicKey, createdAt: Date.now() })
    .returning({ id: projects.id })
    .get();
  return { id: row.id, name, publicKey };
}

export function renameProject(id: number, name: string) {
  db.update(projects).set({ name }).where(eq(projects.id, id)).run();
}

export function rotateProjectKey(id: number): string {
  const key = crypto.randomUUID().replace(/-/g, "");
  db.update(projects).set({ publicKey: key }).where(eq(projects.id, id)).run();
  return key;
}

export function deleteProject(id: number): boolean {
  if (!getProject(id)) return false;
  db.delete(events).where(eq(events.projectId, id)).run();
  db.delete(issues).where(eq(issues.projectId, id)).run();
  db.delete(projects).where(eq(projects.id, id)).run();
  return true;
}

export function projectIssueCount(id: number): number {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(issues)
      .where(eq(issues.projectId, id))
      .get()?.c ?? 0
  );
}

export function projectOpenIssueCount(id: number): number {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(issues)
      .where(and(eq(issues.projectId, id), eq(issues.status, "unresolved")))
      .get()?.c ?? 0
  );
}

export function projectEventsCountSince(id: number, since: number): number {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(events)
      .where(and(eq(events.projectId, id), gt(events.timestamp, since)))
      .get()?.c ?? 0
  );
}

export function projectEnvironments(id: number): string[] {
  return db
    .selectDistinct({ environment: events.environment })
    .from(events)
    .where(and(eq(events.projectId, id), isNotNull(events.environment)))
    .all()
    .map((r) => r.environment as string);
}

export function projectReleases(id: number): ReleaseStat[] {
  const rows = db
    .select({
      name: events.release,
      events: sql<number>`count(*)`,
      lastSeen: sql<number>`max(${events.timestamp})`,
    })
    .from(events)
    .where(and(eq(events.projectId, id), isNotNull(events.release)))
    .groupBy(events.release)
    .orderBy(desc(sql`max(${events.timestamp})`))
    .all();
  return rows
    .filter((r): r is { name: string; events: number; lastSeen: number } => !!r.name)
    .map((r) => ({ name: r.name, events: r.events, lastSeen: r.lastSeen }));
}
