import { Elysia, t } from "elysia";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { EventDetail, EventSummary, ProjectWithStats } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues, projects, sessions } from "../db/schema";
import { ADMIN_PASSWORD, ADMIN_USER, SESSION_TTL_MS } from "../config";

function buildDsn(origin: string, publicKey: string, projectId: number): string {
  return `${origin.replace("://", `://${publicKey}@`)}/${projectId}`;
}

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^bearer /i, "") ?? null;
}

function sessionValid(token: string | null): boolean {
  if (!token) return false;
  const row = db.select().from(sessions).where(eq(sessions.token, token)).get();
  return !!row && row.expiresAt > Date.now();
}

/**
 * Login público: troca usuário+senha por um token de sessão (7 dias).
 */
export const authRoutes = new Elysia({ prefix: "/v1/auth" }).post(
  "/login",
  ({ body, set }) => {
    if (body.username !== ADMIN_USER || body.password !== ADMIN_PASSWORD) {
      set.status = 401;
      return { error: "credenciais inválidas" };
    }
    const token = crypto.randomUUID();
    const now = Date.now();
    db.insert(sessions)
      .values({ token, createdAt: now, expiresAt: now + SESSION_TTL_MS })
      .run();
    // limpeza oportunista de sessões expiradas
    db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
    return { token, user: ADMIN_USER };
  },
  { body: t.Object({ username: t.String(), password: t.String() }) },
);

/**
 * Dashboard API. All routes require `Authorization: Bearer <session token>`.
 * Prefixed with /v1 to never collide with Sentry's /api ingestion paths.
 */
export const apiRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(({ request, set }) => {
    if (!sessionValid(bearerToken(request))) {
      set.status = 401;
      return { error: "unauthorized" };
    }
  })

  .post("/auth/logout", ({ request }) => {
    const token = bearerToken(request);
    if (token) db.delete(sessions).where(eq(sessions.token, token)).run();
    return { ok: true };
  })

  .get("/auth/me", () => ({ user: ADMIN_USER }))

  .get("/projects", ({ request }): ProjectWithStats[] => {
    const origin = new URL(request.url).origin;
    const since = Date.now() - 24 * 3600 * 1000;
    return db
      .select()
      .from(projects)
      .all()
      .map((p) => ({
        ...p,
        dsn: buildDsn(origin, p.publicKey, p.id),
        issueCount:
          db
            .select({ c: sql<number>`count(*)` })
            .from(issues)
            .where(eq(issues.projectId, p.id))
            .get()?.c ?? 0,
        events24h:
          db
            .select({ c: sql<number>`count(*)` })
            .from(events)
            .where(and(eq(events.projectId, p.id), gt(events.timestamp, since)))
            .get()?.c ?? 0,
      }));
  })

  .post(
    "/projects",
    ({ body }) => {
      const publicKey = crypto.randomUUID().replace(/-/g, "");
      const row = db
        .insert(projects)
        .values({ name: body.name, publicKey, createdAt: Date.now() })
        .returning({ id: projects.id })
        .get();
      return { id: row.id, name: body.name, publicKey };
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }) },
  )

  .get("/projects/:id", ({ params, request, set }) => {
    const p = db
      .select()
      .from(projects)
      .where(eq(projects.id, Number(params.id)))
      .get();
    if (!p) {
      set.status = 404;
      return { error: "not found" };
    }
    return { ...p, dsn: buildDsn(new URL(request.url).origin, p.publicKey, p.id) };
  })

  .get(
    "/projects/:id/issues",
    ({ params, query }) =>
      db
        .select()
        .from(issues)
        .where(
          and(
            eq(issues.projectId, Number(params.id)),
            eq(issues.status, query.status === "resolved" ? "resolved" : "unresolved"),
          ),
        )
        .orderBy(desc(issues.lastSeen))
        .limit(200)
        .all(),
    { query: t.Object({ status: t.Optional(t.String()) }) },
  )

  .get("/issues/:id", ({ params, set }) => {
    const issue = db
      .select()
      .from(issues)
      .where(eq(issues.id, Number(params.id)))
      .get();
    if (!issue) {
      set.status = 404;
      return { error: "not found" };
    }
    return issue;
  })

  .get(
    "/issues/:id/events",
    ({ params }): EventSummary[] =>
      db
        .select({
          id: events.id,
          issueId: events.issueId,
          timestamp: events.timestamp,
          level: events.level,
          message: events.message,
        })
        .from(events)
        .where(eq(events.issueId, Number(params.id)))
        .orderBy(desc(events.timestamp))
        .limit(50)
        .all(),
  )

  .get("/events/:id", ({ params, set }): EventDetail | { error: string } => {
    const row = db.select().from(events).where(eq(events.id, params.id)).get();
    if (!row) {
      set.status = 404;
      return { error: "not found" };
    }
    return { ...row, payload: JSON.parse(row.payload) };
  })

  .post(
    "/issues/:id/status",
    ({ params, body }) => {
      db.update(issues)
        .set({ status: body.status })
        .where(eq(issues.id, Number(params.id)))
        .run();
      return { ok: true };
    },
    {
      body: t.Object({
        status: t.Union([t.Literal("unresolved"), t.Literal("resolved")]),
      }),
    },
  );
