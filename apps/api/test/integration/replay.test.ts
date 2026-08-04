/**
 * Integração: session replay (Fase 9) — ingestão de replay_event +
 * replay_recording e leitura pela API.
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

const REPLAY_ID = "replay-test-0001";

/** Envelope com 2 itens: replay_event (metadados) + replay_recording (segmento base64). */
function replayEnvelope(projectId: number, publicKey: string): string {
  const event = {
    replay_id: REPLAY_ID,
    timestamp: Date.now() / 1000,
    release: "1.0.0",
    environment: "production",
    url: "https://meusite.com/checkout",
  };
  const eventPayload = JSON.stringify(event);
  const eventBytes = new TextEncoder().encode(eventPayload);

  // o recording é JSON com replay_id + array `segments` (tag "event" → eventos rrweb)
  const recording = JSON.stringify({
    replay_id: REPLAY_ID,
    segment_id: 0,
    segments: [
      {
        tag: "event",
        data: [
          {
            type: 4,
            timestamp: Date.now() - 1000,
            data: { href: "https://meusite.com/checkout" },
          },
          { type: 3, timestamp: Date.now(), data: { source: 0, text: "oi" } },
        ],
      },
    ],
  });
  const recBytes = new TextEncoder().encode(recording);

  return [
    JSON.stringify({ event_id: "e".repeat(32), dsn: `http://${publicKey}@localhost/${projectId}` }),
    JSON.stringify({
      type: "replay_event",
      content_type: "application/json",
      length: eventBytes.length,
    }),
    eventPayload,
    JSON.stringify({
      type: "replay_recording",
      content_type: "application/octet-stream",
      length: recBytes.length,
      segment_id: 0,
    }),
    recording,
  ].join("\n");
}

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  token = await loginToken(app);
  project = await seedProject("Replay Test");
});

describe("session replay", () => {
  test("replay_event + replay_recording são persistidos e listados", async () => {
    const res = await postEnvelope(
      app,
      project.id,
      project.publicKey,
      replayEnvelope(project.id, project.publicKey),
    );
    expect(res.status).toBe(200);

    const list = await json<Array<{ id: string; kind: string }>>(
      await api(app, token, `/v1/projects/${project.id}/replays`),
    );
    expect(list.some((r) => r.id === REPLAY_ID)).toBe(true);

    // detalhe devolve o replay com os segmentos
    const detail = await json<{ id: string; segments: Array<{ segmentId: number }> }>(
      await api(app, token, `/v1/replays/${REPLAY_ID}`),
    );
    expect(detail.id).toBe(REPLAY_ID);
    expect(detail.segments.length).toBe(1);
    expect(detail.segments[0].segmentId).toBe(0);
  });

  test("idempotência: mesmo segmento enviado 2x não duplica", async () => {
    const before = await json<{ segments: Array<unknown> }>(
      await api(app, token, `/v1/replays/${REPLAY_ID}`),
    );
    const res = await postEnvelope(
      app,
      project.id,
      project.publicKey,
      replayEnvelope(project.id, project.publicKey),
    );
    expect(res.status).toBe(200);
    const after = await json<{ segments: Array<unknown> }>(
      await api(app, token, `/v1/replays/${REPLAY_ID}`),
    );
    expect(after.segments.length).toBe(before.segments.length);
  });
});
