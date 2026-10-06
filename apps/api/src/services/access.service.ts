import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  alertRules,
  events,
  issues,
  orgMembers,
  projects,
  replays,
  savedSearches,
  sourcemapFiles,
  transactions,
} from "../db/schema";
import type { DbUser } from "./user.service";

/**
 * Autorização por projeto: todo recurso do dashboard pertence a um projeto, e
 * o projeto a uma org. Owner (role global) vê tudo; member só vê projetos das
 * orgs em que é membro.
 */

/** Tipos de recurso que podem ser resolvidos para o projeto dono. */
export type ResourceKind =
  | "project"
  | "issue"
  | "event"
  | "transaction"
  | "replay"
  | "alert"
  | "savedSearch"
  | "sourcemap";

/** Projeto dono do recurso (null = recurso não existe). */
export async function projectIdOf(kind: ResourceKind, id: string): Promise<number | null> {
  const num = Number(id);
  const intId = Number.isInteger(num) ? num : -1;
  let row: { projectId: number } | undefined;
  switch (kind) {
    case "project":
      row = await db
        .select({ projectId: projects.id })
        .from(projects)
        .where(eq(projects.id, intId))
        .get();
      break;
    case "issue":
      row = await db
        .select({ projectId: issues.projectId })
        .from(issues)
        .where(eq(issues.id, intId))
        .get();
      break;
    case "event":
      row = await db
        .select({ projectId: events.projectId })
        .from(events)
        .where(eq(events.id, id))
        .get();
      break;
    case "transaction":
      row = await db
        .select({ projectId: transactions.projectId })
        .from(transactions)
        .where(eq(transactions.id, id))
        .get();
      break;
    case "replay":
      row = await db
        .select({ projectId: replays.projectId })
        .from(replays)
        .where(eq(replays.id, id))
        .get();
      break;
    case "alert":
      row = await db
        .select({ projectId: alertRules.projectId })
        .from(alertRules)
        .where(eq(alertRules.id, intId))
        .get();
      break;
    case "savedSearch":
      row = await db
        .select({ projectId: savedSearches.projectId })
        .from(savedSearches)
        .where(eq(savedSearches.id, intId))
        .get();
      break;
    case "sourcemap":
      row = await db
        .select({ projectId: sourcemapFiles.projectId })
        .from(sourcemapFiles)
        .where(eq(sourcemapFiles.id, intId))
        .get();
      break;
  }
  return row?.projectId ?? null;
}

/** IDs dos projetos visíveis ao usuário; null = todos (owner). */
export async function accessibleProjectIds(user: DbUser): Promise<number[] | null> {
  if (user.isOwner) return null;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(orgMembers, eq(orgMembers.orgId, projects.orgId))
    .where(eq(orgMembers.userId, user.id))
    .all();
  return rows.map((r) => r.id);
}

/** O usuário pode acessar o projeto? */
export async function canAccessProject(user: DbUser, projectId: number): Promise<boolean> {
  if (user.isOwner) return true;
  const row = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(orgMembers, eq(orgMembers.orgId, projects.orgId))
    .where(and(eq(projects.id, projectId), eq(orgMembers.userId, user.id)))
    .get();
  return !!row;
}

/** Filtra ids de issues para os que o usuário pode acessar. */
export async function accessibleIssueIds(user: DbUser, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const scope = await accessibleProjectIds(user);
  if (scope === null) return ids;
  if (scope.length === 0) return [];
  const rows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(inArray(issues.id, ids), inArray(issues.projectId, scope)))
    .all();
  return rows.map((r) => r.id);
}
