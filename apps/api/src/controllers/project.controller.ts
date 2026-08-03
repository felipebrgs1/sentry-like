import type { HandlerContext } from "./types";
import * as projectService from "../services/project.service";
import * as issueService from "../services/issue.service";
import type { ProjectWithStats } from "@sentrylike/shared";

/** GET /v1/projects — com DSN e contadores */
export function list({ request }: Pick<HandlerContext, "request">): ProjectWithStats[] {
  const origin = new URL(request.url).origin;
  return projectService.listProjects().map((p) => ({
    ...p,
    dsn: projectService.buildDsn(origin, p.publicKey, p.id),
    issueCount: projectService.projectIssueCount(p.id),
    events24h: projectService.projectEventsCountSince(p.id, Date.now() - 24 * 3600 * 1000),
  }));
}

/** POST /v1/projects */
export function create({ body }: { body: { name: string } }) {
  return projectService.createProject(body.name);
}

/** GET /v1/projects/:id — com DSN e domínios permitidos */
export function get({ params, request, set }: Pick<HandlerContext, "params" | "request" | "set">) {
  const p = projectService.getProject(Number(params.id));
  if (!p) {
    set.status = 404;
    return { error: "not found" };
  }
  return {
    ...p,
    dsn: projectService.buildDsn(new URL(request.url).origin, p.publicKey, p.id),
    allowedDomains: projectService.getAllowedDomains(p),
  };
}

/** GET /v1/projects/:id/issues — com filtros */
export function issues({ params, query }: Pick<HandlerContext, "params" | "query">) {
  return issueService.listProjectIssues(Number(params.id), {
    status: query?.status,
    q: query?.q,
    level: query?.level,
    env: query?.env,
    release: query?.release,
  });
}

/** GET /v1/projects/:id/environments */
export function environments({ params }: Pick<HandlerContext, "params">) {
  return projectService.projectEnvironments(Number(params.id));
}

/** GET /v1/projects/:id/releases */
export function releases({ params }: Pick<HandlerContext, "params">) {
  return projectService.projectReleases(Number(params.id));
}

/** PATCH /v1/projects/:id — renomear e/ou atualizar domínios permitidos */
export function update({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set"> & {
  body: { name?: string; allowedDomains?: string[] };
}) {
  const project = projectService.getProject(Number(params.id));
  if (!project) {
    set.status = 404;
    return { error: "not found" };
  }
  if (body.name !== undefined && body.name.trim()) {
    projectService.renameProject(project.id, body.name.trim());
  }
  if (body.allowedDomains !== undefined) {
    projectService.updateAllowedDomains(
      project.id,
      body.allowedDomains.map((d) => d.trim()).filter(Boolean),
    );
  }
  return { ok: true };
}

/** POST /v1/projects/:id/rotate-key */
export function rotateKey({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!projectService.getProject(Number(params.id))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { publicKey: projectService.rotateProjectKey(Number(params.id)) };
}

/** DELETE /v1/projects/:id */
export function remove({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!projectService.deleteProject(Number(params.id))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}
