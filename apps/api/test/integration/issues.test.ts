/**
 * Integração: issues & grouping (Fase 2) — ciclo de vida completo:
 * agrupamento, resolved/regression, ignore com janela, merge/unmerge,
 * ações em lote, mark as seen, prioridade.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { TestApp } from "../helpers";
import { db } from "../../src/db";
import { issues } from "../../src/db/schema";
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

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  token = await loginToken(app);
  project = await seedProject("Issues Test");
  dsn = `http://${project.publicKey}@localhost/${project.id}`;
});

async function ingest(overrides: Record<string, unknown> = {}) {
  const evt = makeErrorEvent(overrides);
  const res = await postEnvelope(
    app,
    project.id,
    project.publicKey,
    buildEnvelope("event", evt, dsn),
  );
  expect(res.status).toBe(200);
  return evt;
}

async function issueFor(projectId: number): Promise<Array<Record<string, unknown>>> {
  return (await db
    .select()
    .from(issues)
    .where(eq(issues.projectId, projectId))
    .orderBy(issues.id)
    .all()) as unknown as Array<Record<string, unknown>>;
}

/** Evento com fingerprint custom determinístico (evita colisão com outros testes). */
function uniqueError(name: string): Record<string, unknown> {
  return {
    exception: {
      values: [
        {
          type: `IssueError_${name}`,
          value: name,
          stacktrace: {
            frames: [{ filename: `issue-${name}.js`, function: "run", lineno: 1, in_app: true }],
          },
        },
      ],
    },
  };
}

describe("resolved + regressão", () => {
  test("resolver e receber evento novo reabre com badge de regressão", async () => {
    await ingest(uniqueError("regressao"));
    const issue = (await issueFor(project.id)).at(-1)!;
    expect(issue.status).toBe("unresolved");

    const resolved = await api(app, token, `/v1/issues/${issue.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(resolved.status).toBe(200);
    expect((await issueFor(project.id)).at(-1)?.status).toBe("resolved");

    // evento novo com o mesmo fingerprint → reabre + regressão
    await ingest({ ...uniqueError("regressao"), event_id: crypto.randomUUID().replace(/-/g, "") });
    const reopened = (await issueFor(project.id)).at(-1)!;
    expect(reopened.status).toBe("unresolved");
    expect(reopened.regressed).toBe(1);
  });
});

describe("ignore com janela", () => {
  test("ignorar com janela ativa mantém ignorada; janela expirada reabre sem regressão", async () => {
    await ingest(uniqueError("ignore"));
    const issue = (await issueFor(project.id)).at(-1)!;

    // ignore com janela de 60s
    const ignored = await api(app, token, `/v1/issues/${issue.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ignored", ignoreUntil: Date.now() + 60_000 }),
    });
    expect(ignored.status).toBe(200);

    // evento novo dentro da janela → continua ignorada
    await ingest({ ...uniqueError("ignore"), event_id: crypto.randomUUID().replace(/-/g, "") });
    const stillIgnored = (await issueFor(project.id)).at(-1)!;
    expect(stillIgnored.status).toBe("ignored");
    expect(stillIgnored.ignoredUntil).toBeGreaterThan(Date.now());

    // expire a janela direto no banco e receba outro evento → reabre
    await db
      .update(issues)
      .set({ ignoredUntil: Date.now() - 1000 })
      .where(eq(issues.id, issue.id as number))
      .run();
    await ingest({ ...uniqueError("ignore"), event_id: crypto.randomUUID().replace(/-/g, "") });
    const reopened = (await issueFor(project.id)).at(-1)!;
    expect(reopened.status).toBe("unresolved");
    expect(reopened.regressed).toBe(0); // não veio de resolved
  });
});

describe("merge / unmerge", () => {
  test("merge junta issues; unmerge restaura", async () => {
    await ingest(uniqueError("mergeA"));
    await ingest(uniqueError("mergeB"));
    const list = await issueFor(project.id);
    const a = list.find((i) => i.title && String(i.title).includes("mergeA"))!;
    const b = list.find((i) => i.title && String(i.title).includes("mergeB"))!;

    const merged = await api(app, token, `/v1/issues/${a.id}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [b.id] }),
    });
    expect(merged.status).toBe(200);

    const mergedRow = (await issueFor(project.id)).find((i) => i.id === b.id)!;
    expect(mergedRow.mergedInto).toBe(a.id);

    // listagem esconde issues mescladas
    const page = await json<{ items: Array<{ id: number }> }>(
      await api(app, token, `/v1/projects/${project.id}/issues`),
    );
    expect(page.items.some((i) => i.id === b.id)).toBe(false);

    const unmerged = await api(app, token, `/v1/issues/${a.id}/unmerge`, { method: "POST" });
    expect(unmerged.status).toBe(200);
    const after = (await issueFor(project.id)).find((i) => i.id === b.id)!;
    expect(after.mergedInto).toBeNull();
  });
});

describe("ações em lote", () => {
  test("batch resolve várias issues de uma vez", async () => {
    await ingest(uniqueError("batchA"));
    await ingest(uniqueError("batchB"));
    const list = await issueFor(project.id);
    const ids = list.filter((i) => String(i.title).includes("batch")).map((i) => i.id as number);

    const res = await api(app, token, "/v1/issues/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, action: "resolve" }),
    });
    expect(res.status).toBe(200);

    for (const i of await issueFor(project.id)) {
      if (String(i.title).includes("batch")) expect(i.status).toBe("resolved");
    }
  });
});

describe("mark as seen / unread", () => {
  test("issue nova nasce não-lida; ver marca como lida", async () => {
    await ingest(uniqueError("seen"));
    const issue = (await issueFor(project.id)).at(-1)!;
    expect(issue.unread).toBe(1);

    const res = await api(app, token, `/v1/issues/${issue.id}/seen`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await issueFor(project.id)).at(-1)?.unread).toBe(0);
  });
});

describe("prioridade", () => {
  test("fatal + frequente → high", async () => {
    const name = `prio${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      await ingest({
        ...uniqueError(name),
        level: "fatal",
        event_id: crypto.randomUUID().replace(/-/g, ""),
      });
    }
    const issue = (await issueFor(project.id)).at(-1)!;
    expect(issue.priority).toBe("high");
  });
});
