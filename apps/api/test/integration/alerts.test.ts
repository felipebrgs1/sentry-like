/**
 * Integração: alertas (Fase 5) — CRUD de regras, disparo de new_issue/regression
 * via webhook (servidor local capturando o payload), checks periódicos
 * (spike, unresolved_age, digest) e histórico em alert_logs.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { TestApp } from "../helpers";
import { db } from "../../src/db";
import { alertLogs, events, issues } from "../../src/db/schema";
import { runAlertChecks } from "../../src/services/alert.service";
import {
  api,
  buildEnvelope,
  createTestApp,
  initTestDb,
  json,
  loginToken,
  makeErrorEvent,
  postEnvelope,
  seedProject,
} from "../helpers";

let app: TestApp;
let token: string;
let project: { id: number; publicKey: string; orgId: number | null };
let dsn: string;
let webhook: { port: number | undefined; stop: (force?: boolean) => void };
let received: Array<{ body: string; contentType: string | null }>;

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  token = await loginToken(app);
  project = await seedProject("Alerts Test");
  dsn = `http://${project.publicKey}@localhost/${project.id}`;

  received = [];
  webhook = Bun.serve({
    port: 0,
    fetch: async (req) => {
      received.push({
        body: await req.text(),
        contentType: req.headers.get("content-type"),
      });
      return new Response("ok");
    },
  });
});

afterAll(() => {
  webhook.stop(true);
});

const HOOK_URL = () => `http://localhost:${webhook.port}/hook`;

async function createRule(
  type: string,
  config: Record<string, unknown> = {},
  webhookType = "slack",
): Promise<{ id: number }> {
  const res = await api(app, token, `/v1/projects/${project.id}/alert-rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `regra ${type}`,
      type,
      config,
      webhookType,
      webhookUrl: HOOK_URL(),
    }),
  });
  expect(res.status).toBe(200);
  return json<{ id: number }>(res);
}

async function logCount(): Promise<number> {
  return (await db.select().from(alertLogs).where(eq(alertLogs.projectId, project.id)).all())
    .length;
}

describe("CRUD de regras", () => {
  test("cria, lista, desliga e deleta", async () => {
    const rule = await createRule("new_issue");

    const list = await json<Array<{ id: number; enabled: number }>>(
      await api(app, token, `/v1/projects/${project.id}/alert-rules`),
    );
    expect(list.some((r) => r.id === rule.id)).toBe(true);

    const disabled = await api(app, token, `/v1/alerts/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: 0 }),
    });
    expect(disabled.status).toBe(200);
    const listAfter = await json<Array<{ id: number; enabled: number }>>(
      await api(app, token, `/v1/projects/${project.id}/alert-rules`),
    );
    expect(listAfter.find((r) => r.id === rule.id)?.enabled).toBe(0);

    const del = await api(app, token, `/v1/alerts/${rule.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });
});

describe("disparo na ingestão", () => {
  test("new_issue dispara webhook Slack e grava alert_logs ok", async () => {
    await createRule("new_issue");
    const before = await logCount();
    const beforeReceived = received.length;

    const evt = makeErrorEvent({
      exception: {
        values: [
          {
            type: "NewAlertError",
            value: "erro novo",
            stacktrace: {
              frames: [{ filename: "newalert.js", function: "f", lineno: 1, in_app: true }],
            },
          },
        ],
      },
    });
    const res = await postEnvelope(
      app,
      project.id,
      project.publicKey,
      buildEnvelope("event", evt, dsn),
    );
    expect(res.status).toBe(200);

    // webhook recebeu o payload do Slack
    expect(received.length).toBe(beforeReceived + 1);
    const payload = JSON.parse(received.at(-1)!.body);
    expect(payload.text).toContain("Nova issue");
    expect(
      payload.attachments[0].fields.some((f: { title: string }) => f.title === "Projeto"),
    ).toBe(true);

    // histórico com status ok
    expect(await logCount()).toBe(before + 1);
    const log = (
      await db.select().from(alertLogs).where(eq(alertLogs.projectId, project.id)).all()
    ).at(-1)!;
    expect(log.status).toBe("ok");
    expect(log.type).toBe("new_issue");
  });

  test("dedupe: segundo evento da mesma issue não re-dispara (24h)", async () => {
    const before = await logCount();
    const beforeReceived = received.length;

    // mesmo fingerprint do teste anterior → mesma issue
    const evt = makeErrorEvent({
      exception: {
        values: [
          {
            type: "NewAlertError",
            value: "erro novo",
            stacktrace: {
              frames: [{ filename: "newalert.js", function: "f", lineno: 1, in_app: true }],
            },
          },
        ],
      },
    });
    await postEnvelope(app, project.id, project.publicKey, buildEnvelope("event", evt, dsn));

    expect(await logCount()).toBe(before); // sem novo log
    expect(received.length).toBe(beforeReceived); // sem novo webhook
  });

  test("regression dispara webhook quando issue resolvida reabre", async () => {
    await createRule("regression");

    // issue nova
    const evt = makeErrorEvent({
      exception: {
        values: [
          {
            type: "RegressionAlertError",
            value: "vai regredir",
            stacktrace: {
              frames: [{ filename: "reg.js", function: "f", lineno: 1, in_app: true }],
            },
          },
        ],
      },
    });
    await postEnvelope(app, project.id, project.publicKey, buildEnvelope("event", evt, dsn));
    const issue = (await db.select().from(issues).where(eq(issues.projectId, project.id)).all()).at(
      -1,
    )!;

    // resolve
    await api(app, token, `/v1/issues/${issue.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });

    const beforeReceived = received.length;
    // evento novo → regressão
    await postEnvelope(
      app,
      project.id,
      project.publicKey,
      buildEnvelope(
        "event",
        makeErrorEvent({
          exception: {
            values: [
              {
                type: "RegressionAlertError",
                value: "vai regredir",
                stacktrace: {
                  frames: [{ filename: "reg.js", function: "f", lineno: 1, in_app: true }],
                },
              },
            ],
          },
        }),
        dsn,
      ),
    );

    expect(received.length).toBeGreaterThan(beforeReceived);
    const lastPayload = JSON.parse(received.at(-1)!.body);
    expect(lastPayload.text).toContain("Regressão");
  });
});

describe("checks periódicos (runAlertChecks)", () => {
  test("frequency_spike dispara quando a janela atual é muito maior que a anterior", async () => {
    await createRule("frequency_spike", { window_minutes: 10, threshold: 2, min_events: 1 });
    const before = await logCount();
    const now = Date.now();

    // janela anterior: 2 eventos há 15min
    for (let i = 0; i < 2; i++) {
      await db
        .insert(events)
        .values({
          id: crypto.randomUUID().replace(/-/g, ""),
          projectId: project.id,
          timestamp: now - 15 * 60_000,
          message: "spike previous",
          payload: "{}",
        })
        .run();
    }
    // janela atual: 10 eventos agora
    for (let i = 0; i < 10; i++) {
      await db
        .insert(events)
        .values({
          id: crypto.randomUUID().replace(/-/g, ""),
          projectId: project.id,
          timestamp: now,
          message: "spike current",
          payload: "{}",
        })
        .run();
    }

    const beforeReceived = received.length;
    await runAlertChecks();
    expect(await logCount()).toBe(before + 1);
    expect(received.length).toBeGreaterThan(beforeReceived);
    expect(JSON.parse(received.at(-1)!.body).text).toContain("Pico de eventos");
  });

  test("unresolved_age dispara para issue aberta há mais de X dias", async () => {
    await createRule("unresolved_age", { days: 3 });
    const before = await logCount();

    await db
      .insert(issues)
      .values({
        projectId: project.id,
        fingerprint: `old-${crypto.randomUUID()}`,
        title: "Issue antiga",
        status: "unresolved",
        firstSeen: Date.now() - 5 * 24 * 3600_000,
        lastSeen: Date.now() - 5 * 24 * 3600_000,
        eventCount: 1,
      })
      .run();

    const beforeReceived = received.length;
    await runAlertChecks();
    expect(await logCount()).toBe(before + 1);
    expect(received.length).toBeGreaterThan(beforeReceived);
    expect(JSON.parse(received.at(-1)!.body).text).toContain("Issue sem resolver há 3d");
  });

  test("daily_digest dispara com resumo das últimas 24h", async () => {
    await createRule("daily_digest", {}, "generic");
    const before = await logCount();
    const beforeReceived = received.length;

    await runAlertChecks();
    expect(await logCount()).toBe(before + 1);
    expect(received.length).toBeGreaterThan(beforeReceived);
    const payload = JSON.parse(received.at(-1)!.body);
    expect(payload.title).toContain("Resumo diário");
  });
});
