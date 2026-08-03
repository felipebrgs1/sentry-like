import type { HandlerContext } from "./types";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { orgs, projects } from "../db/schema";
import type { Project, SourcemapFile } from "@sentrylike/shared";
import { authenticateUser } from "../services/auth.service";
import { hasOrgAccess, type DbUser } from "../services/user.service";
import * as sourcemapService from "../services/sourcemap.service";

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

/** slugify frouxo — sentry-cli usa o slug do projeto, nós usamos nome/slug. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseBase64Body(body: unknown): {
  name?: string;
  release?: string;
  dist?: string | null;
  content?: string;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    name: typeof b.name === "string" ? b.name : undefined,
    release: typeof b.release === "string" ? b.release : undefined,
    dist: typeof b.dist === "string" ? b.dist : null,
    content: typeof b.content === "string" ? b.content : undefined,
  };
}

/** Formato que o sentry-cli espera (ReleaseFile do protocolo). */
function toSentryFile(
  f: SourcemapFile,
  origin: string,
  org: string,
  project: string,
): Record<string, unknown> {
  const id = String(f.id);
  return {
    id,
    name: f.name,
    size: f.size,
    sha1: f.sha1,
    headers: f.contentType ? { "Content-Type": f.contentType } : {},
    dateCreated: new Date(f.createdAt).toISOString(),
    url: `${origin}/api/0/projects/${org}/${project}/releases/${encodeURIComponent(f.release)}/files/${id}/`,
  };
}

/**
 * Autenticação das rotas /api/0 (sentry-cli): API token (Bearer ou X-Auth-Token).
 * Devolve o usuário ou null (set.status preenchido).
 */
async function sentryAuth(ctx: HandlerContext): Promise<DbUser | null> {
  const token =
    ctx.request.headers.get("x-auth-token") ??
    ctx.request.headers.get("authorization")?.replace(/^bearer /i, "") ??
    null;
  if (!token) {
    ctx.set.status = 401;
    return null;
  }
  const user = await authenticateUser(
    new Request("http://localhost", { headers: { authorization: `Bearer ${token}` } }),
  );
  if (!user) {
    ctx.set.status = 401;
    return null;
  }
  return user;
}

async function orgBySlug(
  ctx: HandlerContext,
  orgSlug: string,
): Promise<typeof orgs.$inferSelect | null> {
  const org = await db.select().from(orgs).where(eq(orgs.slug, orgSlug)).get();
  if (!org) {
    ctx.set.status = 404;
    return null;
  }
  return org;
}

/** Guard de rota de projeto: token + org + projeto da org + acesso. */
async function sentryProjectGuard(
  ctx: HandlerContext,
): Promise<{ user: DbUser; org: typeof orgs.$inferSelect; project: Project } | null> {
  const user = await sentryAuth(ctx);
  if (!user) return null;
  const org = await orgBySlug(ctx, ctx.params.org);
  if (!org) return null;
  const projectSlug = ctx.params.project;
  const rows = await db.select().from(projects).where(eq(projects.orgId, org.id)).all();
  const project = rows.find(
    (p) =>
      p.name === projectSlug || slugify(p.name) === projectSlug || String(p.id) === projectSlug,
  );
  if (!project) {
    ctx.set.status = 404;
    return null;
  }
  if (!(await hasOrgAccess(user, project.orgId))) {
    ctx.set.status = 403;
    return null;
  }
  return { user, org, project };
}

// ------------------------------------------------------------------
// Dashboard (v1) — gestão de sourcemaps por projeto
// ------------------------------------------------------------------

/** GET /v1/projects/:id/sourcemaps[?release=] — lista artefatos */
export async function filesList({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const projectId = Number(params.id);
  const release = query?.release ? String(query.release) : undefined;
  return sourcemapService.listFiles(projectId, release);
}

/** GET /v1/projects/:id/sourcemap-releases — releases com contagens */
export async function releasesList({ params }: Pick<HandlerContext, "params">) {
  return sourcemapService.listReleases(Number(params.id));
}

/** POST /v1/projects/:id/sourcemaps — { name, release, dist?, content(base64) } */
export async function upload({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set">) {
  const b = parseBase64Body(body);
  if (!b.name?.trim() || !b.release?.trim() || !b.content) {
    set.status = 400;
    return { error: "name, release and content (base64) are required" };
  }
  let bytes: Uint8Array;
  try {
    bytes = sourcemapService.base64ToBytes(b.content);
  } catch {
    set.status = 400;
    return { error: "content is not valid base64" };
  }
  if (bytes.byteLength > 16 * 1024 * 1024) {
    set.status = 413;
    return { error: "sourcemap too large (max 16MB)" };
  }
  const file = await sourcemapService.saveFile({
    projectId: Number(params.id),
    release: b.release,
    name: b.name,
    dist: b.dist,
    content: bytes,
  });
  set.status = 201;
  return file;
}

/** DELETE /v1/sourcemaps/:id — apaga um artefato */
export async function remove({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!(await sourcemapService.deleteFile(Number(params.id)))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}

/** DELETE /v1/projects/:id/sourcemaps?release=... — apaga a release inteira */
export async function removeRelease({
  params,
  query,
  set,
}: Pick<HandlerContext, "params" | "query" | "set">) {
  const release = query?.release ? String(query.release) : null;
  if (!release) {
    set.status = 400;
    return { error: "release query param required" };
  }
  const n = await sourcemapService.deleteRelease(Number(params.id), release);
  return { ok: true, deleted: n };
}

// ------------------------------------------------------------------
// sentry-cli compatível (api/0) — upload de sourcemaps por release
// ------------------------------------------------------------------

/** GET /api/0/organizations/:org/releases/:version/files/ — dedup do sentry-cli */
export async function sentryFilesList(ctx: HandlerContext) {
  const origin = new URL(ctx.request.url).origin;
  const org = await orgBySlug(ctx, ctx.params.org);
  if (!org) return { files: [] };
  const user = await sentryAuth(ctx);
  if (!user) return { files: [] };

  let projectIds: number[];
  let projectName = "";
  if (ctx.params.project) {
    // rota por projeto — um único projeto
    const rows = await db.select().from(projects).where(eq(projects.orgId, org.id)).all();
    const project = rows.find(
      (p) =>
        p.name === ctx.params.project ||
        slugify(p.name) === ctx.params.project ||
        String(p.id) === ctx.params.project,
    );
    if (!project) {
      ctx.set.status = 404;
      return { files: [] };
    }
    if (!(await hasOrgAccess(user, project.orgId))) {
      ctx.set.status = 403;
      return { files: [] };
    }
    projectIds = [project.id];
    projectName = project.name;
  } else {
    // rota de organização — todos os projetos da org que o usuário acessa
    const rows = await db.select().from(projects).where(eq(projects.orgId, org.id)).all();
    const accessible: Project[] = [];
    for (const p of rows) if (await hasOrgAccess(user, p.orgId)) accessible.push(p);
    projectIds = accessible.map((p) => p.id);
  }

  const all = [];
  for (const pid of projectIds) {
    const files = await sourcemapService.listFiles(pid, ctx.params.version);
    for (const f of files) {
      // segmento do projeto precisa ser resolvível pelo DELETE — usa o id numérico
      // quando a listagem é org-level (sem nome de projeto disponível)
      all.push(toSentryFile(f, origin, org.slug, projectName || String(pid)));
    }
  }
  return { files: all };
}

/** POST /api/0/projects/:org/:project/releases/:version/files/ — upload single file */
export async function sentryUpload(ctx: HandlerContext) {
  const guard = await sentryProjectGuard(ctx);
  if (!guard) return { error: "unauthorized" };
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name : undefined;
  const content = typeof b.content === "string" ? b.content : undefined;
  const header = (typeof b.header === "object" && b.header !== null ? b.header : {}) as Record<
    string,
    unknown
  >;
  if (!name || !content) {
    ctx.set.status = 400;
    return { error: "name and content (base64) are required" };
  }
  let bytes: Uint8Array;
  try {
    bytes = sourcemapService.base64ToBytes(content);
  } catch {
    ctx.set.status = 400;
    return { error: "content is not valid base64" };
  }
  if (bytes.byteLength > 16 * 1024 * 1024) {
    ctx.set.status = 413;
    return { error: "sourcemap too large (max 16MB)" };
  }
  const file = await sourcemapService.saveFile({
    projectId: guard.project.id,
    release: ctx.params.version,
    name,
    dist: typeof b.dist === "string" ? b.dist : null,
    contentType: typeof header["Content-Type"] === "string" ? header["Content-Type"] : null,
    content: bytes,
  });
  ctx.set.status = 201;
  return toSentryFile(file, new URL(ctx.request.url).origin, guard.org.slug, guard.project.name);
}

/** DELETE /api/0/projects/:org/:project/releases/:version/files/:fileId/ */
export async function sentryDelete(ctx: HandlerContext) {
  const guard = await sentryProjectGuard(ctx);
  if (!guard) return { error: "unauthorized" };
  const id = Number(ctx.params.fileId);
  if (!Number.isInteger(id)) {
    ctx.set.status = 404;
    return { error: "file not found" };
  }
  const file = await sourcemapService.getFile(id);
  if (!file || file.projectId !== guard.project.id) {
    ctx.set.status = 404;
    return { error: "file not found" };
  }
  await sourcemapService.deleteFile(id);
  return {};
}

/**
 * GET /api/0/organizations/:org/chunk-upload/ → 404 de propósito:
 * faz o sentry-cli cair no upload individual (compatível com o VPS micro;
 * chunk upload exigiria bucket de chunks).
 */
export async function sentryChunkUpload(ctx: HandlerContext) {
  ctx.set.status = 404;
  return { detail: "chunk upload not supported" };
}

/** POST /api/0/organizations/:org/chunks/ e /assemble/ → 400 (não suportado). */
export async function sentryChunks(ctx: HandlerContext) {
  ctx.set.status = 400;
  return { detail: "chunk upload not supported — use individual file upload" };
}

export async function sentryAssemble(ctx: HandlerContext) {
  ctx.set.status = 400;
  return { detail: "chunk upload not supported — use individual file upload" };
}

// ------------------------------------------------------------------
// helper para outras rotas: simbolização no detalhe do evento
// ------------------------------------------------------------------

export async function symbolizeEventForDisplay(
  projectId: number,
  release: string | null | undefined,
  event: unknown,
): Promise<unknown> {
  if (typeof event !== "object" || event === null) return event;
  return sourcemapService.symbolizeEvent(projectId, release ?? null, event as never);
}
