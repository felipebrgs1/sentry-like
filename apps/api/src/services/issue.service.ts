import { and, desc, eq, exists, gt, isNull, like, lt, or, sql } from "drizzle-orm";
import type {
  DayCount,
  EventSummary,
  Issue,
  IssuePage,
  IssueStatus,
  SavedSearch,
  SavedSearchFilters,
} from "@sentrylike/shared";
import { db } from "../db";
import { events, issues, savedSearches } from "../db/schema";
import { fillDays } from "../lib/timeseries";
import { computePriority } from "../lib/priority";

const ISSUE_STATUSES = ["unresolved", "resolved", "ignored", "merged"] as const;

export function issueStatus(s?: string): (typeof ISSUE_STATUSES)[number] {
  return ISSUE_STATUSES.find((x) => x === s) ?? "unresolved";
}

export type IssueRow = typeof issues.$inferSelect;

/** Status efetivo: ignore com janela expirada conta como unresolved. */
export function effectiveStatus(row: { status: string; ignoredUntil: number | null }): IssueStatus {
  if (row.status === "ignored" && row.ignoredUntil && row.ignoredUntil < Date.now()) {
    return "unresolved";
  }
  return row.status as IssueStatus;
}

export interface IssueFilters {
  status?: string;
  q?: string;
  level?: string;
  env?: string;
  release?: string;
}

export interface Cursor {
  lastSeen: number;
  id: number;
}

export function encodeCursor(lastSeen: number, id: number): string {
  // btoa/atob (sem Buffer) — portável entre Bun e Workers
  return btoa(`${lastSeen}:${id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(raw?: string): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const [ls, id] = decoded.split(":");
    const lastSeen = Number(ls);
    const idn = Number(id);
    if (!Number.isFinite(lastSeen) || !Number.isInteger(idn)) return null;
    return { lastSeen, id: idn };
  } catch {
    return null;
  }
}

/**
 * Lista issues do projeto com paginação por cursor (lastSeen desc, id desc).
 * Issues mescladas (merged_into != null) ficam ocultas; ignore com janela
 * expirada aparece como "unresolved".
 */
export async function listProjectIssues(
  projectId: number,
  f: IssueFilters,
  cursor: Cursor | null = null,
  limit = 50,
): Promise<IssuePage> {
  const now = Date.now();
  const conds = [eq(issues.projectId, projectId), isNull(issues.mergedInto)];

  const status = issueStatus(f.status);
  if (status === "unresolved") {
    conds.push(
      sql`(${issues.status} = 'unresolved' OR (${issues.status} = 'ignored' AND ${issues.ignoredUntil} IS NOT NULL AND ${issues.ignoredUntil} < ${now}))`,
    );
  } else if (status !== "merged") {
    conds.push(eq(issues.status, status));
  } else {
    conds.push(eq(issues.status, "merged"));
  }

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

  if (cursor) {
    const pageCond = or(
      lt(issues.lastSeen, cursor.lastSeen),
      and(eq(issues.lastSeen, cursor.lastSeen), lt(issues.id, cursor.id)),
    );
    if (pageCond) conds.push(pageCond);
  }

  const rows = await db
    .select()
    .from(issues)
    .where(and(...conds))
    .orderBy(desc(issues.lastSeen), desc(issues.id))
    .limit(limit + 1) // +1 para saber se há próxima página
    .all();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map((r) => ({ ...r, status: effectiveStatus(r) })),
    nextCursor: hasMore && last ? encodeCursor(last.lastSeen, last.id) : null,
  };
}

export async function recentIssues(status?: string, limit = 10): Promise<Issue[]> {
  const now = Date.now();
  const conds = [isNull(issues.mergedInto)];
  if (issueStatus(status) === "unresolved") {
    conds.push(
      sql`(${issues.status} = 'unresolved' OR (${issues.status} = 'ignored' AND ${issues.ignoredUntil} IS NOT NULL AND ${issues.ignoredUntil} < ${now}))`,
    );
  } else {
    conds.push(eq(issues.status, issueStatus(status)));
  }
  const rows = await db
    .select()
    .from(issues)
    .where(and(...conds))
    .orderBy(desc(issues.lastSeen))
    .limit(limit)
    .all();
  return rows.map((r) => ({ ...r, status: effectiveStatus(r) }));
}

export async function getIssue(id: number): Promise<Issue | undefined> {
  const row = await db.select().from(issues).where(eq(issues.id, id)).get();
  return row ? { ...row, status: effectiveStatus(row) } : undefined;
}

/** Seta o status. `ignoreUntil` (ms) vale só para "ignored". */
export function updateIssueStatus(
  id: number,
  status: IssueStatus,
  ignoreUntil: number | null = null,
) {
  db.update(issues)
    .set({
      status,
      ignoredUntil: status === "ignored" ? ignoreUntil : null,
      // resolver limpa a regressão; reabrir também
      regressed: status === "unresolved" || status === "resolved" ? 0 : undefined,
    })
    .where(eq(issues.id, id))
    .run();
}

export async function setIssueSeen(id: number) {
  await db.update(issues).set({ unread: 0 }).where(eq(issues.id, id)).run();
}

export async function assignIssue(id: number, assignedTo: string | null) {
  await db
    .update(issues)
    .set({ assignedTo: assignedTo ? assignedTo.trim().slice(0, 120) || null : null })
    .where(eq(issues.id, id))
    .run();
}

export async function deleteIssue(id: number): Promise<boolean> {
  const existing = getIssue(id);
  if (!existing) return false;
  await db.delete(events).where(eq(events.issueId, id)).run();
  await db.delete(issues).where(eq(issues.id, id)).run();
  return true;
}

export async function listIssueEvents(id: number): Promise<EventSummary[]> {
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

export async function getEvent(
  id: string,
): Promise<(EventSummary & { payload: string }) | undefined> {
  return await db.select().from(events).where(eq(events.id, id)).get();
}

export async function issueEventsPerDay(id: number, days = 14): Promise<DayCount[]> {
  const now = Date.now();
  const since = now - days * 24 * 3600 * 1000;
  const rows = await db
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

// ------------------------------------------------------------------
// Merge / unmerge (Fase 2)
// ------------------------------------------------------------------

/**
 * Mescla `ids` na issue alvo. Os eventos das origens são movidos para o alvo
 * guardando `original_issue_id` (para o unmerge). As origens ficam ocultas
 * com status "merged" + merged_into = alvo.
 */
export async function mergeIssues(targetId: number, ids: number[]): Promise<boolean> {
  const target = await db.select().from(issues).where(eq(issues.id, targetId)).get();
  if (!target) return false;
  const sources: IssueRow[] = [];
  for (const id of ids) {
    if (id === targetId) continue;
    const r = await db.select().from(issues).where(eq(issues.id, id)).get();
    if (r && r.mergedInto == null) sources.push(r);
  }
  if (!sources.length) return false;

  for (const src of sources) {
    // preserva a primeira origem registrada (merge em cascata)
    await db
      .update(events)
      .set({
        issueId: targetId,
        originalIssueId: sql`coalesce(${events.originalIssueId}, ${src.id})`,
      })
      .where(eq(events.issueId, src.id))
      .run();
    await db
      .update(issues)
      .set({ status: "merged", mergedInto: targetId, unread: 0 })
      .where(eq(issues.id, src.id))
      .run();
  }

  recomputeIssueStats(targetId);
  return true;
}

/** Restaura issues que foram mescladas no alvo, movendo de volta seus eventos. */
export async function unmergeIssues(targetId: number): Promise<boolean> {
  const merged = await db
    .select()
    .from(issues)
    .where(and(eq(issues.mergedInto, targetId), eq(issues.status, "merged")))
    .all();
  if (!merged.length) return false;

  for (const src of merged) {
    await db
      .update(events)
      .set({ issueId: src.id })
      .where(and(eq(events.originalIssueId, src.id), eq(events.issueId, targetId)))
      .run();
    await db
      .update(issues)
      .set({
        status: "unresolved",
        mergedInto: null,
        regressed: 0,
        priority: computePriority(src.level, src.eventCount, src.lastSeen),
      })
      .where(eq(issues.id, src.id))
      .run();
    recomputeIssueStats(src.id);
  }
  recomputeIssueStats(targetId);
  return true;
}

/** Recalcula eventCount, firstSeen, lastSeen, priority a partir dos eventos. */
async function recomputeIssueStats(id: number) {
  const row = await db
    .select({
      count: sql<number>`count(*)`,
      first: sql<number>`min(${events.timestamp})`,
      last: sql<number>`max(${events.timestamp})`,
    })
    .from(events)
    .where(eq(events.issueId, id))
    .get();
  if (!row) return;
  await db
    .update(issues)
    .set({
      eventCount: row.count,
      firstSeen: row.first,
      lastSeen: row.last,
      priority: computePriority("error", row.count, row.last),
    })
    .where(eq(issues.id, id))
    .run();
}

// ------------------------------------------------------------------
// Ações em lote (Fase 2)
// ------------------------------------------------------------------

export type BatchAction = "resolve" | "unresolve" | "ignore" | "seen" | "delete";

export function batchUpdate(ids: number[], action: BatchAction, ignoreUntil: number | null = null) {
  for (const id of ids) {
    if (action === "delete") {
      deleteIssue(id);
      continue;
    }
    if (action === "seen") {
      setIssueSeen(id);
      continue;
    }
    const status: IssueStatus =
      action === "resolve" ? "resolved" : action === "ignore" ? "ignored" : "unresolved";
    updateIssueStatus(id, status, status === "ignored" ? ignoreUntil : null);
  }
  return { ok: true };
}

// ------------------------------------------------------------------
// Search salva (Fase 2)
// ------------------------------------------------------------------

export async function listSavedSearches(projectId: number): Promise<SavedSearch[]> {
  const rows = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.projectId, projectId))
    .orderBy(desc(savedSearches.createdAt))
    .all();
  return rows.map((r) => ({ ...r, filters: JSON.parse(r.filters) as SavedSearchFilters }));
}

export async function createSavedSearch(
  projectId: number,
  name: string,
  filters: SavedSearchFilters,
): Promise<SavedSearch> {
  const row = await db
    .insert(savedSearches)
    .values({
      projectId,
      name: name.trim().slice(0, 80),
      filters: JSON.stringify(filters),
      createdAt: Date.now(),
    })
    .returning({ id: savedSearches.id })
    .get();
  return { id: row.id, projectId, name: name.trim().slice(0, 80), filters, createdAt: Date.now() };
}

export async function deleteSavedSearch(id: number): Promise<boolean> {
  const existing = await db.select().from(savedSearches).where(eq(savedSearches.id, id)).get();
  if (!existing) return false;
  await db.delete(savedSearches).where(eq(savedSearches.id, id)).run();
  return true;
}
