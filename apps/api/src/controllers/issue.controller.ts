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

/** POST /v1/issues/:id/status */
export function updateStatus({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set">) {
  const status = (body as { status?: string } | undefined)?.status;
  if (!status || !VALID_STATUSES.includes(status as IssueStatus)) {
    set.status = 400;
    return { error: "invalid status" };
  }
  issueService.updateIssueStatus(Number(params.id), status as IssueStatus);
  return { ok: true };
}

/** DELETE /v1/issues/:id */
export function remove({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!issueService.deleteIssue(Number(params.id))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}
