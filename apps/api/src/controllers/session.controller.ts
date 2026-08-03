import type { HandlerContext } from "./types";
import * as sessionService from "../services/session.service";

/** GET /v1/projects/:id/crash-free — rate por release */
export async function crashFree({ params }: Pick<HandlerContext, "params">) {
  return sessionService.releaseCrashFree(Number(params.id));
}

/** GET /v1/projects/:id/crash-free-series?release=&days= */
export async function crashFreeSeries({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const days = Math.min(Math.max(Number(query?.days ?? 14), 1), 90);
  return sessionService.crashFreeSeries(Number(params.id), query?.release || undefined, days);
}

/** GET /v1/projects/:id/sessions?limit= */
export async function sessions({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const limit = Math.min(Math.max(Number(query?.limit ?? 20), 1), 200);
  return sessionService.listSessions(Number(params.id), limit);
}

/** GET /v1/issues/:id/user-reports */
export async function issueReports({ params }: Pick<HandlerContext, "params">) {
  return sessionService.issueUserReports(Number(params.id));
}

/** GET /v1/projects/:id/user-reports?limit= */
export async function projectReports({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const limit = Math.min(Math.max(Number(query?.limit ?? 50), 1), 200);
  return sessionService.projectUserReports(Number(params.id), limit);
}
