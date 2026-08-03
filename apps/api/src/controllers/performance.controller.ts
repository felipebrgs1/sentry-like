import type { HandlerContext } from "./types";
import * as perfService from "../services/performance.service";

function filters(query?: Record<string, string | undefined>) {
  return {
    release: query?.release,
    env: query?.env,
    q: query?.q,
  };
}

/** GET /v1/projects/:id/transaction-summaries */
export function summaries({ params, query }: Pick<HandlerContext, "params" | "query">) {
  return perfService.transactionSummaries(Number(params.id), filters(query));
}

/** GET /v1/projects/:id/transactions — recentes */
export function list({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const limit = Math.min(Math.max(Number(query?.limit ?? 100), 1), 500);
  return perfService.recentTransactions(Number(params.id), filters(query), limit);
}

/** GET /v1/projects/:id/transaction-series?name=… */
export function series({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const days = Math.min(Math.max(Number(query?.days ?? 14), 1), 90);
  return perfService.transactionSeries(Number(params.id), query?.name ?? "", filters(query), days);
}

/** GET /v1/transactions/:id */
export function detail({ params, set }: Pick<HandlerContext, "params" | "set">) {
  const t = perfService.getTransaction(params.id);
  if (!t) {
    set.status = 404;
    return { error: "not found" };
  }
  return t;
}

/** GET /v1/projects/:id/web-vitals */
export function vitals({ params, query }: Pick<HandlerContext, "params" | "query">) {
  return perfService.webVitals(Number(params.id), filters(query));
}

/** GET /v1/projects/:id/release-performance */
export function releases({ params, query }: Pick<HandlerContext, "params" | "query">) {
  return perfService.releasePerformance(Number(params.id), filters(query));
}
