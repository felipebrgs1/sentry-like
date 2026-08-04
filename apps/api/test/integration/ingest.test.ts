/**
 * Integração: protocolo de ingestão do Sentry (Fase 1).
 * Cobre envelope multi-item, store legado, gzip/deflate, tunnel, validação,
 * autenticação por DSN key, origin check e rate limit HTTP (429 + header).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { TestApp } from "../helpers";
import { db } from "../../src/db";
import { attachments, events, issues } from "../../src/db/schema";
import { MemoryRateLimiter, setRateLimiter } from "../../src/lib/ratelimit";
import {
  buildEnvelope,
  createTestApp,
  initTestDb,
  json,
  makeErrorEvent,
  postEnvelope,
  seedProject,
} from "../helpers";

let app: TestApp;
let project: { id: number; publicKey: string; orgId: number | null };
let key: string;

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  project = await seedProject("Ingest Test");
  key = project.publicKey;
});

async function issueCount(): Promise<number> {
  return (await db.select().from(issues).where(eq(issues.projectId, project.id)).all()).length;
}

/** Evento com fingerprint custom determinístico (grupo próprio). */
function customFingerprintEvent(eventId: string): ReturnType<typeof makeErrorEvent> {
  return makeErrorEvent({
    event_id: eventId,
    exception: {
      values: [
        {
          type: "UniqueError",
          value: "grupo proprio",
          stacktrace: {
            frames: [
              { filename: "custom.js", function: "run", lineno: 1, in_app: true },
              { filename: "custom.js", function: "explode", lineno: 2, in_app: true },
            ],
          },
        },
      ],
    },
  });
}

describe("health", () => {
  test("GET /health responde ok", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean }>(res);
    expect(body.ok).toBe(true);
  });
});

describe("POST /api/:id/envelope/", () => {
  test("evento válido → 200 com id do evento", async () => {
    const evt = makeErrorEvent();
    const res = await postEnvelope(
      app,
      project.id,
      key,
      buildEnvelope("event", evt, `http://${key}@localhost/${project.id}`),
    );
    expect(res.status).toBe(200);
    const body = await json<{ id: string }>(res);
    expect(body.id).toBe(evt.event_id);

    // persiste o evento e cria a issue agrupada
    const row = await db.select().from(events).where(eq(events.id, evt.event_id)).get();
    expect(row).toBeDefined();
    expect(row?.projectId).toBe(project.id);
    expect(await issueCount()).toBe(1);
  });

  test("2 eventos com o mesmo fingerprint custom → 1 issue nova com eventCount 2", async () => {
    const before = await issueCount();
    const a = await postEnvelope(
      app,
      project.id,
      key,
      buildEnvelope(
        "event",
        customFingerprintEvent(crypto.randomUUID().replace(/-/g, "")),
        `http://${key}@localhost/${project.id}`,
      ),
    );
    const b = await postEnvelope(
      app,
      project.id,
      key,
      buildEnvelope(
        "event",
        customFingerprintEvent(crypto.randomUUID().replace(/-/g, "")),
        `http://${key}@localhost/${project.id}`,
      ),
    );
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await issueCount()).toBe(before + 1);
    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.projectId, project.id))
      .orderBy(issues.lastSeen)
      .all();
    expect(issue.at(-1)?.eventCount).toBe(2);
  });

  test("envelope multi-item (event + attachment) processa os dois", async () => {
    const evt = makeErrorEvent();
    const att = "log attachment content"; // ASCII: chars == bytes
    const payload = JSON.stringify(evt);
    const body = [
      JSON.stringify({ event_id: evt.event_id, dsn: `http://${key}@localhost/${project.id}` }),
      JSON.stringify({ type: "event", content_type: "application/json", length: payload.length }),
      payload,
      JSON.stringify({
        type: "attachment",
        length: att.length,
        filename: "log.txt",
        content_type: "text/plain",
      }),
      att,
    ].join("\n");
    const res = await postEnvelope(app, project.id, key, body);
    expect(res.status).toBe(200);
    const attRow = await db
      .select()
      .from(attachments)
      .where(eq(attachments.eventId, evt.event_id))
      .get();
    expect(attRow?.name).toBe("log.txt");
  });

  test("payload inválido → 400 com detail", async () => {
    const res = await postEnvelope(
      app,
      project.id,
      key,
      "isto não é um envelope\n{ type: 'event', length: 4 }\nabcd",
    );
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ detail: "invalid envelope" });
  });

  test("envelope grande demais → 413", async () => {
    const big = "x".repeat(11 * 1024 * 1024);
    const res = await postEnvelope(app, project.id, key, big);
    expect(res.status).toBe(413);
  });

  test("key errada → 403", async () => {
    const res = await postEnvelope(
      app,
      project.id,
      "ffffffffffffffffffffffffffffffff",
      buildEnvelope("event", makeErrorEvent(), "http://x@localhost/1"),
    );
    expect(res.status).toBe(403);
  });

  test("sem key → 403", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/${project.id}/envelope/`, {
        method: "POST",
        body: buildEnvelope("event", makeErrorEvent(), "http://x@localhost/1"),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("projeto inexistente → 404", async () => {
    const res = await postEnvelope(
      app,
      9999,
      key,
      buildEnvelope("event", makeErrorEvent(), "http://x@localhost/9999"),
    );
    expect(res.status).toBe(404);
  });

  test("sentry_trace é injetado no contexto do evento", async () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    const spanId = "abcdef0123456789";
    const evt = makeErrorEvent();
    const res = await postEnvelope(
      app,
      project.id,
      key,
      buildEnvelope("event", evt, `http://${key}@localhost/${project.id}`),
      { "sentry-trace": `${traceId}-${spanId}` },
    );
    expect(res.status).toBe(200);
    const row = await db.select().from(events).where(eq(events.id, evt.event_id)).get();
    const payload = JSON.parse(row!.payload);
    expect(payload.contexts.trace.trace_id).toBe(traceId);
    expect(payload.contexts.trace.span_id).toBe(spanId);
  });

  test("evento que falha a validação (JSON válido, sem conteúdo) é descartado", async () => {
    const before = await issueCount();
    const payload = "{}"; // JSON válido, mas sem message/exception/etc → validateEvent rejeita
    const body = [
      JSON.stringify({ event_id: "b".repeat(32), dsn: `http://${key}@localhost/${project.id}` }),
      JSON.stringify({ type: "event", length: payload.length }),
      payload,
    ].join("\n");
    const res = await postEnvelope(app, project.id, key, body);
    expect(res.status).toBe(200);
    expect((await json<{ id: string }>(res)).id).toBe("ignored");
    expect(await issueCount()).toBe(before);
  });
});

describe("POST /api/:id/store/ (legado)", () => {
  test("evento JSON → id", async () => {
    const evt = makeErrorEvent();
    const res = await app.handle(
      new Request(`http://localhost/api/${project.id}/store/`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sentry-auth": `sentry_key=${key}` },
        body: JSON.stringify(evt),
      }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ id: string }>(res)).id).toBe(evt.event_id);
  });

  test("evento inválido → 400 com motivo descritivo", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/${project.id}/store/`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sentry-auth": `sentry_key=${key}` },
        body: JSON.stringify({ foo: 1 }), // sem message/exception/etc
      }),
    );
    expect(res.status).toBe(400);
    const body = await json<{ detail: string }>(res);
    expect(body.detail).toContain("no message");
  });

  test("gzip (SDK legado) → id", async () => {
    const evt = makeErrorEvent();
    const gz = Bun.gzipSync(new TextEncoder().encode(JSON.stringify(evt)));
    const res = await app.handle(
      new Request(`http://localhost/api/${project.id}/store/`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "x-sentry-auth": `sentry_key=${key}`,
        },
        body: gz,
      }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ id: string }>(res)).id).toBe(evt.event_id);
  });
});

describe("POST /api/tunnel", () => {
  test("DSN no header do envelope → processa", async () => {
    const evt = makeErrorEvent();
    const dsn = `http://${key}@localhost/${project.id}`;
    const res = await app.handle(
      new Request("http://localhost/api/tunnel", {
        method: "POST",
        headers: { "content-type": "application/x-sentry-envelope" },
        body: buildEnvelope("event", evt, dsn),
      }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ id: string }>(res)).id).toBe(evt.event_id);
  });

  test("sem DSN → 403", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/tunnel", {
        method: "POST",
        body: buildEnvelope("event", makeErrorEvent(), "http://x@localhost/1"),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("key desconhecida → 403", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/tunnel", {
        method: "POST",
        body: buildEnvelope("event", makeErrorEvent(), "http://zzzz@localhost/1"),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("origin check (allowed_domains)", () => {
  test("origem não permitida → 403; permitida → 200", async () => {
    const restricted = await seedProject("Restricted", {
      allowedDomains: ["example.com", "*.sub.com"],
    });
    const dsn = `http://${restricted.publicKey}@localhost/${restricted.id}`;

    const evil = await postEnvelope(
      app,
      restricted.id,
      restricted.publicKey,
      buildEnvelope("event", makeErrorEvent(), dsn),
      { origin: "https://evil.com" },
    );
    expect(evil.status).toBe(403);

    const ok = await postEnvelope(
      app,
      restricted.id,
      restricted.publicKey,
      buildEnvelope("event", makeErrorEvent(), dsn),
      { origin: "https://example.com" },
    );
    expect(ok.status).toBe(200);

    // wildcard: subdomínio permitido
    const sub = await postEnvelope(
      app,
      restricted.id,
      restricted.publicKey,
      buildEnvelope("event", makeErrorEvent(), dsn),
      { origin: "https://app.sub.com" },
    );
    expect(sub.status).toBe(200);
  });
});

describe("rate limit HTTP (X-Sentry-Rate-Limits)", () => {
  test("após o limite, responde 429 com header no formato do Sentry", async () => {
    setRateLimiter(new MemoryRateLimiter(3));
    try {
      const rlProject = await seedProject("Rate Limited");
      const dsn = `http://${rlProject.publicKey}@localhost/${rlProject.id}`;
      for (let i = 0; i < 3; i++) {
        const res = await postEnvelope(
          app,
          rlProject.id,
          rlProject.publicKey,
          buildEnvelope("event", makeErrorEvent(), dsn),
        );
        expect(res.status).toBe(200);
      }
      const limited = await postEnvelope(
        app,
        rlProject.id,
        rlProject.publicKey,
        buildEnvelope("event", makeErrorEvent(), dsn),
      );
      expect(limited.status).toBe(429);
      const header = limited.headers.get("x-sentry-rate-limits");
      expect(header).toContain("60000:error:project");
    } finally {
      setRateLimiter(new MemoryRateLimiter());
    }
  });
});
