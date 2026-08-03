import type { HandlerContext } from "./types";
import * as projectService from "../services/project.service";
import * as issueService from "../services/issue.service";
import type { ProjectWithStats } from "@sentrylike/shared";

/** GET /v1/projects — com DSN e contadores */
export async function list({
  request,
}: Pick<HandlerContext, "request">): Promise<ProjectWithStats[]> {
  const origin = new URL(request.url).origin;
  const projects = await projectService.listProjects();
  const out: ProjectWithStats[] = [];
  for (const p of projects) {
    out.push({
      ...p,
      dsn: projectService.buildDsn(origin, p.publicKey, p.id),
      issueCount: await projectService.projectIssueCount(p.id),
      events24h: await projectService.projectEventsCountSince(p.id, Date.now() - 24 * 3600 * 1000),
    });
  }
  return out;
}

/** POST /v1/projects */
export async function create({ body }: { body: { name: string } }) {
  return projectService.createProject(body.name);
}

/** GET /v1/projects/:id — com DSN e domínios permitidos */
export async function get({
  params,
  request,
  set,
}: Pick<HandlerContext, "params" | "request" | "set">) {
  const p = await projectService.getProject(Number(params.id));
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

/** GET /v1/projects/:id/issues — com filtros e paginação por cursor */
export async function issues({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const limit = Math.min(Math.max(Number(query?.limit ?? 50), 1), 200);
  return issueService.listProjectIssues(
    Number(params.id),
    {
      status: query?.status,
      q: query?.q,
      level: query?.level,
      env: query?.env,
      release: query?.release,
    },
    issueService.decodeCursor(query?.cursor),
    limit,
  );
}

/** GET /v1/projects/:id/saved-searches */
export async function savedSearches({ params }: Pick<HandlerContext, "params">) {
  return issueService.listSavedSearches(Number(params.id));
}

/** POST /v1/projects/:id/saved-searches */
export async function createSavedSearch({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set">) {
  const b = (body ?? {}) as { name?: string; filters?: Record<string, string | undefined> };
  const name = b.name?.trim();
  if (!name) {
    set.status = 400;
    return { error: "name is required" };
  }
  return issueService.createSavedSearch(Number(params.id), name, b.filters ?? {});
}

/** DELETE /v1/saved-searches/:id */
export async function removeSavedSearch({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!(await issueService.deleteSavedSearch(Number(params.id)))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}

/** GET /v1/projects/:id/environments */
export async function environments({ params }: Pick<HandlerContext, "params">) {
  return projectService.projectEnvironments(Number(params.id));
}

/** GET /v1/projects/:id/releases */
export async function releases({ params }: Pick<HandlerContext, "params">) {
  return projectService.projectReleases(Number(params.id));
}

/** PATCH /v1/projects/:id — renomear e/ou atualizar domínios permitidos */
export async function update({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set"> & {
  body: { name?: string; allowedDomains?: string[] };
}) {
  const project = await projectService.getProject(Number(params.id));
  if (!project) {
    set.status = 404;
    return { error: "not found" };
  }
  if (body.name !== undefined && body.name.trim()) {
    await projectService.renameProject(project.id, body.name.trim());
  }
  if (body.allowedDomains !== undefined) {
    await projectService.updateAllowedDomains(
      project.id,
      body.allowedDomains.map((d) => d.trim()).filter(Boolean),
    );
  }
  return { ok: true };
}

/** POST /v1/projects/:id/rotate-key */
export async function rotateKey({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!(await projectService.getProject(Number(params.id)))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { publicKey: await projectService.rotateProjectKey(Number(params.id)) };
}

/** DELETE /v1/projects/:id */
export async function remove({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!(await projectService.deleteProject(Number(params.id)))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}
