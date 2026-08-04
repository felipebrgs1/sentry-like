/**
 * Integração: sessões & crash-free (Fase 6) — item `sessions` do envelope,
 * rate por release e série temporal.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { TestApp } from "../helpers";
import {
  api,
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

/** Item de sessão no formato do protocolo Sentry. */
function sessionItem(opts: { sid: string; status: string; release: string; errors?: number }) {
  return {
    sid: opts.sid,
    init: true,
    started: Date.now() / 1000 - 60,
    timestamp: Date.now() / 1000,
    status: opts.status,
    errors: opts.errors ?? 0,
    release: opts.release,
    environment: "production",
    attrs: { release: opts.release, environment: "production" },
  };
}

function sessionsEnvelope(
  projectId: number,
  publicKey: string,
  ...sessions: Array<Record<string, unknown>>
): string {
  const lines: string[] = [JSON.stringify({ dsn: `http://${publicKey}@localhost/${projectId}` })];
  for (const s of sessions) {
    const payload = JSON.stringify(s);
    const bytes = new TextEncoder().encode(payload);
    lines.push(JSON.stringify({ type: "session", length: bytes.length }));
    lines.push(payload);
  }
  return lines.join("\n");
}

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  token = await loginToken(app);
  project = await seedProject("Sessions Test");
});

describe("ingestão de sessões", () => {
  test("aceita item sessions (ok + crashed) e calcula crash-free por release", async () => {
    const ok = await postEnvelope(
      app,
      project.id,
      project.publicKey,
      sessionsEnvelope(
        project.id,
        project.publicKey,
        sessionItem({ sid: "s-ok-1", status: "ok", release: "1.0.0" }),
        sessionItem({ sid: "s-ok-2", status: "ok", release: "1.0.0" }),
        sessionItem({ sid: "s-crash", status: "crashed", release: "1.0.0" }),
      ),
    );
    expect(ok.status).toBe(200);

    const crashFree = await json<
      Array<{ release: string; total: number; crashed: number; crashFree: number }>
    >(await api(app, token, `/v1/projects/${project.id}/crash-free`));
    const row = crashFree.find((r) => r.release === "1.0.0");
    expect(row).toBeDefined();
    expect(row!.total).toBe(3);
    expect(row!.crashed).toBe(1);
    expect(row!.crashFree).toBeCloseTo(2 / 3, 5);
  });

  test("série temporal crash-free por dia", async () => {
    await postEnvelope(
      app,
      project.id,
      project.publicKey,
      sessionsEnvelope(
        project.id,
        project.publicKey,
        sessionItem({ sid: "s-serie", status: "ok", release: "1.0.0" }),
      ),
    );

    const series = await json<Array<{ date: string; total: number; crashFree: number }>>(
      await api(app, token, `/v1/projects/${project.id}/crash-free-series?release=1.0.0&days=7`),
    );
    expect(series).toHaveLength(7);
    // hoje inclui as 3 sessões do teste anterior (1 crashed) + esta → crashFree < 1
    expect(series.at(-1)?.total).toBeGreaterThanOrEqual(4);
    expect(series.at(-1)?.crashFree).toBeCloseTo(3 / 4, 5);
  });

  test("listagem de sessões recentes", async () => {
    const res = await api(app, token, `/v1/projects/${project.id}/sessions`);
    expect(res.status).toBe(200);
    const list = await json<Array<{ sid: string }>>(res);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((s) => s.sid === "s-crash")).toBe(true);
  });
});
