import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { Project, ReleaseStat } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues, projects } from "../db/schema";

export function buildDsn(origin: string, publicKey: string, projectId: number): string {
  return `${origin.replace("://", `://${publicKey}@`)}/${projectId}`;
}

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects).all();
}

export async function getProject(id: number): Promise<Project | undefined> {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export async function getProjectByKey(publicKey: string): Promise<Project | undefined> {
  return db.select().from(projects).where(eq(projects.publicKey, publicKey)).get();
}

/** Domínios permitidos para CORS (JSON array armazenado) — null/vazio = todos. */
export function getAllowedDomains(project: Project): string[] {
  if (!project.allowedDomains) return [];
  try {
    const parsed = JSON.parse(project.allowedDomains);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

export async function createProject(name: string): Promise<{
  id: number;
  name: string;
  publicKey: string;
}> {
  const publicKey = crypto.randomUUID().replace(/-/g, "");
  const row = await db
    .insert(projects)
    .values({ name, publicKey, createdAt: Date.now() })
    .returning({ id: projects.id })
    .get();
  return { id: row.id, name, publicKey };
}

export async function renameProject(id: number, name: string) {
  await db.update(projects).set({ name }).where(eq(projects.id, id)).run();
}

export async function updateAllowedDomains(id: number, domains: string[]) {
  await db
    .update(projects)
    .set({ allowedDomains: JSON.stringify(domains) })
    .where(eq(projects.id, id))
    .run();
}

export async function rotateProjectKey(id: number): Promise<string> {
  const key = crypto.randomUUID().replace(/-/g, "");
  await db.update(projects).set({ publicKey: key }).where(eq(projects.id, id)).run();
  return key;
}

export async function deleteProject(id: number): Promise<boolean> {
  if (!(await getProject(id))) return false;
  await db.delete(events).where(eq(events.projectId, id)).run();
  await db.delete(issues).where(eq(issues.projectId, id)).run();
  await db.delete(projects).where(eq(projects.id, id)).run();
  return true;
}

export async function projectIssueCount(id: number): Promise<number> {
  return (
    (
      await db
        .select({ c: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.projectId, id))
        .get()
    )?.c ?? 0
  );
}

export async function projectOpenIssueCount(id: number): Promise<number> {
  const now = Date.now();
  return (
    (
      await db
        .select({ c: sql<number>`count(*)` })
        .from(issues)
        .where(
          and(
            eq(issues.projectId, id),
            isNull(issues.mergedInto),
            sql`(${issues.status} = 'unresolved' OR (${issues.status} = 'ignored' AND ${issues.ignoredUntil} IS NOT NULL AND ${issues.ignoredUntil} < ${now}))`,
          ),
        )
        .get()
    )?.c ?? 0
  );
}

export async function projectEventsCountSince(id: number, since: number): Promise<number> {
  return (
    (
      await db
        .select({ c: sql<number>`count(*)` })
        .from(events)
        .where(and(eq(events.projectId, id), gt(events.timestamp, since)))
        .get()
    )?.c ?? 0
  );
}

export async function projectEnvironments(id: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ environment: events.environment })
    .from(events)
    .where(and(eq(events.projectId, id), isNotNull(events.environment)))
    .all();
  return rows.map((r) => r.environment as string);
}

export async function projectReleases(id: number): Promise<ReleaseStat[]> {
  const rows = await db
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
