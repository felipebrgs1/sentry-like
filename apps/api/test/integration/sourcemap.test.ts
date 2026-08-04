/**
 * Integração: sourcemaps (Fase 8) — upload pelo protocolo do sentry-cli
 * (api/0 com API token) e simbolização no detalhe do evento.
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
  makeErrorEvent,
  postEnvelope,
  seedProject,
} from "../helpers";

let app: TestApp;
let token: string;
let project: { id: number; publicKey: string; orgId: number | null };
let apiToken: string;

const RELEASE = "1.0.0";

/** Sourcemap v3 mínimo: frame minificado (linha 1, col 21 → "boom") mapeia para src/app.js linha 2 col 1. */
const SOURCE_MAP = JSON.stringify({
  version: 3,
  sources: ["src/app.js"],
  sourcesContent: ["function add(a,b){return a+b}\nfunction boom(){return add(1,2)}"],
  names: ["add", "boom"],
  // segmento 1: genCol 0 → source 0, linha 0, col 0, name 0 ("add")
  // segmento 2: genCol +20 → source 0, linha +1, col 0, name +1 ("boom")
  mappings: "AAAAA,oBACAC",
});

function b64(s: string): string {
  return Buffer.from(s).toString("base64");
}

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  token = await loginToken(app);
  project = await seedProject("Sourcemap Test");

  const created = await api(app, token, "/v1/api-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "sourcemap-ci" }),
  });
  apiToken = (await json<{ token: string }>(created)).token;
});

async function sentryUpload(name: string, content: string): Promise<Response> {
  return app.handle(
    new Request(
      `http://localhost/api/0/projects/default/${project.id}/releases/${RELEASE}/files/`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": apiToken },
        body: JSON.stringify({
          name,
          content: b64(content),
          header: { "Content-Type": "application/json" },
        }),
      },
    ),
  );
}

describe("protocolo do sentry-cli", () => {
  test("upload de arquivo com X-Auth-Token → 201", async () => {
    const res = await sentryUpload("app.js.map", SOURCE_MAP);
    expect(res.status).toBe(201);
    const file = await json<{ name: string; size: number }>(res);
    expect(file.name).toBe("app.js.map");
    expect(file.size).toBeGreaterThan(0);
  });

  test("sem token → não autorizado", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/0/projects/default/${project.id}/releases/${RELEASE}/files/`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x.js", content: b64("x") }),
        },
      ),
    );
    expect(res.status).toBe(401);
  });

  test("chunk-upload responde 404 de propósito (sentry-cli cai no individual)", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/0/organizations/default/chunk-upload/", {
        method: "GET",
        headers: { "x-auth-token": apiToken },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("listagem de arquivos da release", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/0/projects/default/${project.id}/releases/${RELEASE}/files/`,
        {
          headers: { "x-auth-token": apiToken },
        },
      ),
    );
    expect(res.status).toBe(200);
    const body = await json<{ files: Array<{ name: string }> }>(res);
    expect(body.files.some((f) => f.name === "app.js.map")).toBe(true);
  });
});

describe("simbolização na leitura", () => {
  test("frame minificado é simbolizado no /v1/events/:id", async () => {
    const evt = makeErrorEvent({
      release: RELEASE,
      exception: {
        values: [
          {
            type: "Error",
            value: "boom",
            stacktrace: {
              frames: [
                { filename: "app.js", function: "boom", lineno: 1, colno: 21, in_app: true },
              ],
            },
          },
        ],
      },
    });
    const res = await postEnvelope(
      app,
      project.id,
      project.publicKey,
      buildEnvelope("event", evt, `http://${project.publicKey}@localhost/${project.id}`),
    );
    expect(res.status).toBe(200);

    const detail = await json<{
      payload: {
        exception: { values: Array<{ stacktrace: { frames: Array<Record<string, unknown>> } }> };
      };
    }>(await api(app, token, `/v1/events/${evt.event_id}`));
    const frame = detail.payload.exception.values[0].stacktrace.frames[0];
    expect(frame.symbolicated).toBe(true);
    expect(frame.original_source).toBe("src/app.js");
    expect(frame.original_lineno).toBe(2);
    expect(frame.original_colno).toBe(1);
    expect(frame.original_function).toBe("boom");
    // contexto do código-fonte real (Fase 8)
    expect(frame.original_context_line).toContain("boom");
  });
});
