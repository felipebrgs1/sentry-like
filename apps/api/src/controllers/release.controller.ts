import type { HandlerContext } from "./types";
import * as releaseService from "../services/release.service";
import * as issueService from "../services/issue.service";
import { getWebhookSecret } from "../services/project.service";
import { verifyDeployWebhook } from "../lib/signature";
import type { ReleaseCommit } from "@sentrylike/shared";

/** GET /v1/projects/:id/releases */
export async function list({ params }: Pick<HandlerContext, "params">) {
  return releaseService.listReleases(Number(params.id));
}

/** GET /v1/projects/:id/release-detail?name=… */
export async function detail({
  params,
  query,
  set,
}: Pick<HandlerContext, "params" | "query" | "set">) {
  const name = query?.name;
  if (!name) {
    set.status = 400;
    return { error: "name is required" };
  }
  const r = await releaseService.getReleaseDetail(Number(params.id), name);
  if (!r) {
    set.status = 404;
    return { error: "release not found" };
  }
  return r;
}

/** GET /v1/projects/:id/releases-compare?a=…&b=… */
export async function compare({
  params,
  query,
  set,
}: Pick<HandlerContext, "params" | "query" | "set">) {
  const a = query?.a;
  const b = query?.b;
  if (!a || !b) {
    set.status = 400;
    return { error: "a and b are required" };
  }
  const r = await releaseService.compareReleases(Number(params.id), a, b);
  if (!r) {
    set.status = 404;
    return { error: "one of the releases was not found" };
  }
  return r;
}

/** POST /v1/projects/:id/releases — marca deploy/metadata manualmente */
export async function mark({ params, body, set }: Pick<HandlerContext, "params" | "body" | "set">) {
  const b = (body ?? {}) as {
    name?: string;
    commits?: ReleaseCommit[];
    deployedAt?: number | null;
  };
  if (!b.name?.trim()) {
    set.status = 400;
    return { error: "name is required" };
  }
  await releaseService.markRelease(Number(params.id), b.name, {
    commits: b.commits,
    deployedAt: b.deployedAt,
  });
  return { ok: true };
}

/** GET /v1/issues/:id/environments — distribuição por ambiente */
export async function issueEnvironments({ params }: Pick<HandlerContext, "params">) {
  if (!(await issueService.getIssue(Number(params.id)))) {
    return [];
  }
  return releaseService.issueEnvironments(Number(params.id));
}

/** GET /v1/issues/:id/releases — distribuição por release */
export async function issueReleases({ params }: Pick<HandlerContext, "params">) {
  return releaseService.issueReleases(Number(params.id));
}

/**
 * POST /v1/webhooks/releases/:projectId — GitHub/GitLab push (público, server-to-server).
 * Autenticado pelo segredo do projeto; sem segredo configurado o webhook fica desativado.
 */
export async function webhook({
  params,
  request,
  set,
}: Pick<HandlerContext, "params" | "request" | "set">) {
  const projectId = Number(params.projectId);
  const secret = Number.isInteger(projectId) ? await getWebhookSecret(projectId) : null;
  const raw = new Uint8Array(await request.arrayBuffer());
  if (!secret || !(await verifyDeployWebhook(secret, raw, request.headers))) {
    set.status = 401;
    return { error: "invalid or missing webhook signature" };
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    set.status = 400;
    return { error: "invalid JSON" };
  }
  const name = await releaseService.handleDeployWebhook(projectId, body);
  return { ok: true, release: name };
}
