/**
 * Integração: performance (Fase 4) — transactions/spans, waterfall,
 * métricas (p50/p95/p99), web vitals e série temporal.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { TestApp } from "../helpers";
import {
  api,
  buildEnvelope,
  createTestApp,
  initTestDb,
  json,
  loginToken,
  postEnvelope,
  seedProject,
} from "../helpers";

let app: TestApp;
let token: string;
let project: { id: number; publicKey: string; orgId: number | null };
let dsn: string;

const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SPAN_ROOT = "bbbbbbbbbbbbbbbb";
const SPAN_DB = "cccccccccccccccc";

function makeTransaction(
  name: string,
  opts: { durationMs?: number; measurements?: Record<string, unknown> } = {},
) {
  const start = Date.now() / 1000 - 0.4;
  return {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    type: "transaction",
    transaction: name,
    start_timestamp: start,
    timestamp: start + 0.4,
    release: "0.1.0",
    environment: "production",
    platform: "javascript",
    contexts: {
      trace: { trace_id: TRACE_ID, span_id: SPAN_ROOT, op: "http.server" },
    },
    user: { geo: { country_code: "BR" }, id: "user-1" },
    measurements: opts.measurements ?? {
      lcp: { value: 1500 },
      fcp: { value: 900 },
      cls: { value: 0.05 },
      ttfb: { value: 200 },
    },
    spans: [
      {
        span_id: SPAN_DB,
        trace_id: TRACE_ID,
        parent_span_id: SPAN_ROOT,
        op: "db.query",
        description: "SELECT * FROM orders",
        start_timestamp: start + 0.05,
        timestamp: start + 0.25,
      },
    ],
    ...opts,
  };
}

async function ingestTransaction(name: string) {
  const evt = makeTransaction(name);
  const res = await postEnvelope(
    app,
    project.id,
    project.publicKey,
    buildEnvelope("transaction", evt, dsn),
  );
  expect(res.status).toBe(200);
  return evt;
}

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  token = await loginToken(app);
  project = await seedProject("Perf Test");
  dsn = `http://${project.publicKey}@localhost/${project.id}`;
});

describe("ingestão de transactions", () => {
  test("persiste transaction + spans", async () => {
    const evt = await ingestTransaction("GET /checkout");
    expect(evt.event_id).toBeDefined();

    const res = await api(app, token, `/v1/transactions/${evt.event_id}`);
    expect(res.status).toBe(200);
    const detail = await json<{ name: string; spans: Array<{ op: string }> }>(res);
    expect(detail.name).toBe("GET /checkout");
    expect(detail.spans.length).toBeGreaterThanOrEqual(1);
    expect(detail.spans.some((s) => s.op === "db.query")).toBe(true);
  });
});

describe("métricas", () => {
  test("transaction-summaries agrupa por nome com avg/p95/erro", async () => {
    await ingestTransaction("GET /pagamento");
    await ingestTransaction("GET /pagamento");

    const res = await api(app, token, `/v1/projects/${project.id}/transaction-summaries`);
    expect(res.status).toBe(200);
    const summaries = await json<Array<{ name: string; avg: number; p95: number }>>(res);
    const found = summaries.find((s) => s.name === "GET /pagamento");
    expect(found).toBeDefined();
    expect(found!.avg).toBeGreaterThan(0);
    expect(found!.p95).toBeGreaterThan(0);
  });

  test("transaction-series devolve pontos por dia", async () => {
    await ingestTransaction("GET /serie");
    const res = await api(
      app,
      token,
      `/v1/projects/${project.id}/transaction-series?name=${encodeURIComponent("GET /serie")}`,
    );
    expect(res.status).toBe(200);
    const series = await json<Array<{ date: string; count: number }>>(res);
    expect(series.length).toBeGreaterThan(0);
    expect(series.at(-1)?.count).toBeGreaterThanOrEqual(1);
  });

  test("web-vitals devolve p50/p75/p95 das measurements", async () => {
    await ingestTransaction("GET /vitals");
    const res = await api(app, token, `/v1/projects/${project.id}/web-vitals`);
    expect(res.status).toBe(200);
    const vitals = await json<Record<string, { p50: number }>>(res);
    expect(vitals.lcp?.p50).toBe(1500);
    expect(vitals.cls?.p50).toBe(0.05);
  });

  test("segmentação por país (user.geo.country_code) no detalhe", async () => {
    const evt = await ingestTransaction("GET /geo");
    const detail = await json<{ country: string | null }>(
      await api(app, token, `/v1/transactions/${evt.event_id}`),
    );
    expect(detail.country).toBe("BR");
  });
});
