import type { HandlerContext } from "./types";
import * as projectService from "../services/project.service";
import * as issueService from "../services/issue.service";
import * as userService from "../services/user.service";
import type { ProjectWithStats } from "@sentrylike/shared";

/** Owner pode tudo; mutações de projeto (criar/renomear/rotacionar/deletar) são owner-only. */
function requireOwner(ctx: Pick<HandlerContext, "store" | "set">): boolean {
  if (!ctx.store.user?.isOwner) {
    ctx.set.status = 403;
    return false;
  }
  return true;
}

/** GET /v1/projects — com DSN e contadores (filtrado pela org do usuário) */
export async function list({
  request,
  store,
}: Pick<HandlerContext, "request" | "store">): Promise<ProjectWithStats[]> {
  const origin = new URL(request.url).origin;
  const projects = await projectService.listProjects();
  const visible = store.user?.isOwner ? projects : await filterByOrg(projects, store.user?.id ?? 0);
  const out: ProjectWithStats[] = [];
  for (const p of visible) {
    out.push({
      ...p,
      dsn: projectService.buildDsn(origin, p.publicKey, p.id),
      issueCount: await projectService.projectIssueCount(p.id),
      events24h: await projectService.projectEventsCountSince(p.id, Date.now() - 24 * 3600 * 1000),
    });
  }
  return out;
}

async function filterByOrg(
  all: Awaited<ReturnType<typeof projectService.listProjects>>,
  userId: number,
) {
  const orgs = await userService.listUserOrgs(userId);
  const orgIds = new Set(orgs.map((o) => o.id));
  return all.filter((p) => p.orgId != null && orgIds.has(p.orgId));
}

/** POST /v1/projects */
export async function create({
  body,
  store,
  set,
}: { body: { name: string } } & Pick<HandlerContext, "store" | "set">) {
  if (!requireOwner({ store, set })) return { error: "owner only" };
  const project = await projectService.createProject(body.name);
  // projeto entra na org default
  const orgId = await userService.defaultOrgId();
  if (orgId) await projectService.assignOrg(project.id, orgId);
  return project;
}

/** GET /v1/projects/:id — com DSN e domínios permitidos */
export async function get({
  params,
  request,
  set,
  store,
}: Pick<HandlerContext, "params" | "request" | "set" | "store">) {
  const p = await projectService.getProject(Number(params.id));
  if (!p) {
    set.status = 404;
    return { error: "not found" };
  }
  if (!(await userService.hasOrgAccess(store.user!, p.orgId))) {
    set.status = 403;
    return { error: "forbidden" };
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
  store,
}: Pick<HandlerContext, "params" | "body" | "set" | "store"> & {
  body: { name?: string; allowedDomains?: string[] };
}) {
  if (!requireOwner({ store, set })) return { error: "owner only" };
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
export async function rotateKey({
  params,
  set,
  store,
}: Pick<HandlerContext, "params" | "set" | "store">) {
  if (!requireOwner({ store, set })) return { error: "owner only" };
  if (!(await projectService.getProject(Number(params.id)))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { publicKey: await projectService.rotateProjectKey(Number(params.id)) };
}

/** DELETE /v1/projects/:id */
export async function remove({
  params,
  set,
  store,
}: Pick<HandlerContext, "params" | "set" | "store">) {
  if (!requireOwner({ store, set })) return { error: "owner only" };
  if (!(await projectService.deleteProject(Number(params.id)))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}
