import { Elysia, t } from "elysia";
import { and, desc, eq, exists, gt, isNotNull, like, lt, sql } from "drizzle-orm";
import type { EventDetail, EventSummary, OverviewStats, ProjectWithStats } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues, projects, sessions } from "../db/schema";
import { ADMIN_PASSWORD, ADMIN_USER, SESSION_TTL_MS } from "../config";

function buildDsn(origin: string, publicKey: string, projectId: number): string {
  return `${origin.replace("://", `://${publicKey}@`)}/${projectId}`;
}

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^bearer /i, "") ?? null;
}

const ISSUE_STATUSES = ["unresolved", "resolved", "ignored"] as const;
function issueStatus(s?: string): (typeof ISSUE_STATUSES)[number] {
  return ISSUE_STATUSES.find((x) => x === s) ?? "unresolved";
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

  .post(
    "/auth/logout", ({ request }) => {
    const token = bearerToken(request);
    if (token) db.delete(sessions).where(eq(sessions.token, token)).run();
    return { ok: true };
  })

  .get("/auth/me", () => ({ user: ADMIN_USER }))

  // Issues recentes (todos os projetos) — página inicial
  .get(
    "/issues",
    ({ query }) =>
      db
        .select()
        .from(issues)
        .where(eq(issues.status, issueStatus(query.status)))
        .orderBy(desc(issues.lastSeen))
        .limit(Math.min(Number(query.limit ?? 10), 50))
        .all(),
    { query: t.Object({ status: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
  )

  // Visão geral: cards + gráfico de eventos
  .get("/stats", (): OverviewStats => {
    const now = Date.now();
    const d24 = now - 24 * 3600 * 1000;
    const d7 = now - 7 * 24 * 3600 * 1000;
    const d14 = now - 14 * 24 * 3600 * 1000;

    const countWhere = (cond: any) =>
      db.select({ c: sql<number>`count(*)` }).from(events).where(cond).get()?.c ?? 0;

    const openIssues =
      db
        .select({ c: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.status, "unresolved"))
        .get()?.c ?? 0;

    const perDay = db
      .select({
        day: sql<string>`date(timestamp / 1000, 'unixepoch')`,
        count: sql<number>`count(*)`,
      })
      .from(events)
      .where(gt(events.timestamp, d14))
      .groupBy(sql`date(timestamp / 1000, 'unixepoch')`)
      .all();

    const map = new Map(perDay.map((r) => [r.day, r.count]));
    const eventsPerDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now - (13 - i) * 24 * 3600 * 1000);
      const date = d.toISOString().slice(0, 10);
      return { date, count: map.get(date) ?? 0 };
    });

    const projectStats = db.select().from(projects).all().map((p) => ({
      id: p.id,
      name: p.name,
      openIssues:
        db
          .select({ c: sql<number>`count(*)` })
          .from(issues)
          .where(and(eq(issues.projectId, p.id), eq(issues.status, "unresolved")))
          .get()?.c ?? 0,
      events24h: countWhere(and(eq(events.projectId, p.id), gt(events.timestamp, d24))),
    }));

    return {
      openIssues,
      events24h: countWhere(gt(events.timestamp, d24)),
      events7d: countWhere(gt(events.timestamp, d7)),
      eventsPerDay,
      projects: projectStats,
    };
  })

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
    ({ params, query }) => {
      const conds = [eq(issues.projectId, Number(params.id))];
      conds.push(eq(issues.status, issueStatus(query.status)));
      if (query.q) conds.push(like(issues.title, `%${query.q.trim()}%`));
      if (query.level) conds.push(eq(issues.level, query.level));
      // issue pode ter eventos de vários ambientes/releases — filtra pelos eventos
      if (query.env) {
        conds.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(events)
              .where(and(eq(events.issueId, issues.id), eq(events.environment, query.env))),
          ),
        );
      }
      if (query.release) {
        conds.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(events)
              .where(and(eq(events.issueId, issues.id), eq(events.release, query.release))),
          ),
        );
      }

      return db
        .select()
        .from(issues)
        .where(and(...conds))
        .orderBy(desc(issues.lastSeen))
        .limit(200)
        .all();
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        q: t.Optional(t.String()),
        level: t.Optional(t.String()),
        env: t.Optional(t.String()),
        release: t.Optional(t.String()),
      }),
    },
  )

  .get("/projects/:id/environments", ({ params }) =>
    db
      .selectDistinct({ environment: events.environment })
      .from(events)
      .where(
        and(
          eq(events.projectId, Number(params.id)),
          isNotNull(events.environment),
        ),
      )
      .all()
      .map((r) => r.environment as string),
  )

  .get("/projects/:id/releases", ({ params }) => {
    const rows = db
      .select({
        name: events.release,
        events: sql<number>`count(*)`,
        lastSeen: sql<number>`max(${events.timestamp})`,
      })
      .from(events)
      .where(
        and(
          eq(events.projectId, Number(params.id)),
          isNotNull(events.release),
        ),
      )
      .groupBy(events.release)
      .orderBy(desc(sql`max(${events.timestamp})`))
      .all();
    return rows
      .filter((r): r is { name: string; events: number; lastSeen: number } => !!r.name)
      .map((r) => ({ name: r.name, events: r.events, lastSeen: r.lastSeen }));
  })

  .patch(
    "/projects/:id",
    ({ params, body }) => {
      db.update(projects)
        .set({ name: body.name })
        .where(eq(projects.id, Number(params.id)))
        .run();
      return { ok: true };
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }) },
  )

  .post("/projects/:id/rotate-key", ({ params }) => {
    const key = crypto.randomUUID().replace(/-/g, "");
    db.update(projects)
      .set({ publicKey: key })
      .where(eq(projects.id, Number(params.id)))
      .run();
    return { publicKey: key };
  })

  .delete("/projects/:id", ({ params }) => {
    const id = Number(params.id);
    db.delete(events).where(eq(events.projectId, id)).run();
    db.delete(issues).where(eq(issues.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
    return { ok: true };
  })

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
          environment: events.environment,
          release: events.release,
          message: events.message,
        })
        .from(events)
        .where(eq(events.issueId, Number(params.id)))
        .orderBy(desc(events.timestamp))
        .limit(50)
        .all(),
  )

  // Eventos por dia (últimos 14 dias) para o gráfico da issue
  .get("/issues/:id/stats", ({ params }) => {
    const now = Date.now();
    const d14 = now - 14 * 24 * 3600 * 1000;
    const perDay = db
      .select({
        day: sql<string>`date(timestamp / 1000, 'unixepoch')`,
        count: sql<number>`count(*)`,
      })
      .from(events)
      .where(and(eq(events.issueId, Number(params.id)), gt(events.timestamp, d14)))
      .groupBy(sql`date(timestamp / 1000, 'unixepoch')`)
      .all();
    const map = new Map(perDay.map((r) => [r.day, r.count]));
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now - (13 - i) * 24 * 3600 * 1000);
      const date = d.toISOString().slice(0, 10);
      return { date, count: map.get(date) ?? 0 };
    });
  })

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
        status: t.Union([
          t.Literal("unresolved"),
          t.Literal("resolved"),
          t.Literal("ignored"),
        ]),
      }),
    },
  )

  .delete("/issues/:id", ({ params }) => {
    const id = Number(params.id);
    db.delete(events).where(eq(events.issueId, id)).run();
    db.delete(issues).where(eq(issues.id, id)).run();
    return { ok: true };
  });
