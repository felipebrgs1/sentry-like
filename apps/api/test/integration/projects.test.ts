/**
 * Integração: CRUD de projetos, rotate key, allowed_domains e endpoints de issue por projeto.
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
} from "../helpers";

let app: TestApp;
let token: string;

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  token = await loginToken(app);
});

describe("CRUD de projetos", () => {
  test("cria → lista → get → renomeia → deleta", async () => {
    const created = await api(app, token, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Meu App" }),
    });
    expect(created.status).toBe(200);
    const project = await json<{ id: number; publicKey: string; name: string }>(created);
    expect(project.publicKey).toHaveLength(32);
    expect(project.name).toBe("Meu App");

    const list = await api(app, token, "/v1/projects");
    const projects = await json<Array<{ id: number }>>(list);
    expect(projects.some((p) => p.id === project.id)).toBe(true);

    const get = await api(app, token, `/v1/projects/${project.id}`);
    expect((await json<{ name: string }>(get)).name).toBe("Meu App");

    const renamed = await api(app, token, `/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renomeado" }),
    });
    expect(renamed.status).toBe(200);
    const after = await json<{ name: string }>(await api(app, token, `/v1/projects/${project.id}`));
    expect(after.name).toBe("Renomeado");

    const del = await api(app, token, `/v1/projects/${project.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await api(app, token, `/v1/projects/${project.id}`)).status).toBe(404);
  });

  test("nome vazio → 422 (validação do schema)", async () => {
    const res = await api(app, token, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("rotate key", () => {
  test("a key antiga para de funcionar e a nova vale para ingestão", async () => {
    const created = await api(app, token, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Rotate" }),
    });
    const { id, publicKey } = await json<{ id: number; publicKey: string }>(created);

    // ingestão com a key atual funciona
    const okBefore = await postEnvelope(
      app,
      id,
      publicKey,
      buildEnvelope("event", makeErrorEvent(), `http://${publicKey}@localhost/${id}`),
    );
    expect(okBefore.status).toBe(200);

    const rotated = await api(app, token, `/v1/projects/${id}/rotate-key`, { method: "POST" });
    const { publicKey: newKey } = await json<{ publicKey: string }>(rotated);
    expect(newKey).not.toBe(publicKey);

    // key antiga → 403
    const oldKey = await postEnvelope(
      app,
      id,
      publicKey,
      buildEnvelope("event", makeErrorEvent(), `http://${publicKey}@localhost/${id}`),
    );
    expect(oldKey.status).toBe(403);

    // key nova → 200
    const newKeyOk = await postEnvelope(
      app,
      id,
      newKey,
      buildEnvelope("event", makeErrorEvent(), `http://${newKey}@localhost/${id}`),
    );
    expect(newKeyOk.status).toBe(200);
  });
});

describe("allowed_domains", () => {
  test("atualiza e a lista é refletida no origin check", async () => {
    const created = await api(app, token, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Domains" }),
    });
    const { id, publicKey } = await json<{ id: number; publicKey: string }>(created);
    const dsn = `http://${publicKey}@localhost/${id}`;

    const patched = await api(app, token, `/v1/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedDomains: ["meusite.com"] }),
    });
    expect(patched.status).toBe(200);

    const evil = await postEnvelope(
      app,
      id,
      publicKey,
      buildEnvelope("event", makeErrorEvent(), dsn),
      {
        origin: "https://outro.com",
      },
    );
    expect(evil.status).toBe(403);

    const ok = await postEnvelope(
      app,
      id,
      publicKey,
      buildEnvelope("event", makeErrorEvent(), dsn),
      {
        origin: "https://meusite.com",
      },
    );
    expect(ok.status).toBe(200);
  });
});

describe("issues por projeto", () => {
  test("listagem com filtros (status/level/env)", async () => {
    const created = await api(app, token, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "IssuesList" }),
    });
    const { id, publicKey } = await json<{ id: number; publicKey: string }>(created);
    const dsn = `http://${publicKey}@localhost/${id}`;

    await postEnvelope(app, id, publicKey, buildEnvelope("event", makeErrorEvent(), dsn));
    // fingerprint DIFERENTE (outro tipo de exceção + frames) → vira outra issue
    await postEnvelope(
      app,
      id,
      publicKey,
      buildEnvelope(
        "event",
        makeErrorEvent({
          level: "warning",
          message: "aviso",
          exception: {
            values: [
              {
                type: "WarningError",
                value: "atencao",
                stacktrace: {
                  frames: [{ filename: "warn.js", function: "warn", lineno: 5, in_app: true }],
                },
              },
            ],
          },
        }),
        dsn,
      ),
    );

    const all = await json<{ items: Array<{ level: string }> }>(
      await api(app, token, `/v1/projects/${id}/issues`),
    );
    expect(all.items.length).toBeGreaterThanOrEqual(2);

    const filtered = await json<{ items: Array<{ level: string }> }>(
      await api(app, token, `/v1/projects/${id}/issues?level=warning`),
    );
    expect(filtered.items.length).toBe(1);
    expect(filtered.items[0].level).toBe("warning");
  });
});
