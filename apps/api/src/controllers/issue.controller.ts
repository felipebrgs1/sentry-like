import type { HandlerContext } from "./types";
import type { IssueStatus } from "@sentrylike/shared";
import * as issueService from "../services/issue.service";

const VALID_STATUSES: IssueStatus[] = ["unresolved", "resolved", "ignored"];

/** GET /v1/issues — recentes (todos os projetos) */
export function recent({ query }: Pick<HandlerContext, "query">) {
  return issueService.recentIssues(query?.status, Math.min(Number(query?.limit ?? 10), 50));
}

/** GET /v1/issues/:id */
export function get({ params, set }: Pick<HandlerContext, "params" | "set">) {
  const issue = issueService.getIssue(Number(params.id));
  if (!issue) {
    set.status = 404;
    return { error: "not found" };
  }
  return issue;
}

/** GET /v1/issues/:id/events */
export function events({ params }: Pick<HandlerContext, "params">) {
  return issueService.listIssueEvents(Number(params.id));
}

/** GET /v1/events/:id — evento completo com payload parseado */
export function eventDetail({ params, set }: Pick<HandlerContext, "params" | "set">) {
  const row = issueService.getEvent(params.id);
  if (!row) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ...row, payload: JSON.parse(row.payload) };
}

/** GET /v1/issues/:id/stats — eventos por dia (gráfico) */
export function stats({ params }: Pick<HandlerContext, "params">) {
  return issueService.issueEventsPerDay(Number(params.id));
}

/** POST /v1/issues/:id/status — com suporte a "ignorar por X" (ignoreUntil ms) */
export function updateStatus({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set">) {
  const b = (body ?? {}) as { status?: string; ignoreUntil?: number | null };
  if (!b.status || !VALID_STATUSES.includes(b.status as IssueStatus)) {
    set.status = 400;
    return { error: "invalid status" };
  }
  const ignoreUntil =
    b.status === "ignored" && typeof b.ignoreUntil === "number" && b.ignoreUntil > Date.now()
      ? b.ignoreUntil
      : null;
  issueService.updateIssueStatus(Number(params.id), b.status as IssueStatus, ignoreUntil);
  return { ok: true };
}

/** POST /v1/issues/:id/seen — marca como lida */
export function seen({ params }: Pick<HandlerContext, "params">) {
  issueService.setIssueSeen(Number(params.id));
  return { ok: true };
}

/** POST /v1/issues/:id/assign — define owner (texto livre até multi-user) */
export function assign({ params, body, set }: Pick<HandlerContext, "params" | "body" | "set">) {
  const b = (body ?? {}) as { assignedTo?: string | null };
  if (b.assignedTo !== undefined && typeof b.assignedTo !== "string") {
    set.status = 400;
    return { error: "assignedTo must be a string" };
  }
  issueService.assignIssue(Number(params.id), b.assignedTo ?? null);
  return { ok: true };
}

/** POST /v1/issues/:id/merge — mescla `ids` na issue alvo */
export function merge({ params, body, set }: Pick<HandlerContext, "params" | "body" | "set">) {
  const ids = ((body as { ids?: unknown } | undefined)?.ids ?? []) as unknown[];
  if (!ids.every((i) => Number.isInteger(i))) {
    set.status = 400;
    return { error: "ids must be an array of integers" };
  }
  if (!issueService.mergeIssues(Number(params.id), ids.map(Number))) {
    set.status = 404;
    return { error: "nothing to merge" };
  }
  return { ok: true };
}

/** POST /v1/issues/:id/unmerge — restaura issues mescladas */
export function unmerge({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!issueService.unmergeIssues(Number(params.id))) {
    set.status = 404;
    return { error: "no merged issues" };
  }
  return { ok: true };
}

/** POST /v1/issues/batch — ações em lote */
export function batch({ body, set }: Pick<HandlerContext, "body" | "set">) {
  const b = (body ?? {}) as {
    ids?: unknown;
    action?: string;
    ignoreUntil?: number | null;
  };
  if (!Array.isArray(b.ids) || !b.ids.every((i) => Number.isInteger(i)) || b.ids.length === 0) {
    set.status = 400;
    return { error: "ids must be a non-empty array of integers" };
  }
  const valid: issueService.BatchAction[] = ["resolve", "unresolve", "ignore", "seen", "delete"];
  if (!b.action || !valid.includes(b.action as issueService.BatchAction)) {
    set.status = 400;
    return { error: "invalid action" };
  }
  const ignoreUntil =
    b.action === "ignore" && typeof b.ignoreUntil === "number" && b.ignoreUntil > Date.now()
      ? b.ignoreUntil
      : null;
  return issueService.batchUpdate(
    b.ids.map(Number),
    b.action as issueService.BatchAction,
    ignoreUntil,
  );
}

/** DELETE /v1/issues/:id */
export function remove({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!issueService.deleteIssue(Number(params.id))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}
