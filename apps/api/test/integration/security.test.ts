/**
 * Integração: Fase 11 (segurança) — um teste por vetor encontrado na auditoria:
 * path traversal no BlobStore, decompression bomb, autorização por projeto
 * (IDOR), identidade por request (store global do Elysia), webhook de deploy
 * assinado, SSRF em webhooks de alerta, brute force de login e tokens em hash.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { authGuard, currentUser } from "../../src/middleware/auth";
import { db } from "../../src/db";
import { alertRules, apiTokens, issues, orgs, sessions } from "../../src/db/schema";
import { DATA_DIR, MAX_ENVELOPE_BYTES } from "../../src/config";
import { hmacSha256Hex } from "../../src/lib/signature";
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
let ownerToken: string;
let memberToken: string;
let mine: { id: number; publicKey: string };
let foreign: { id: number; publicKey: string };
let foreignIssueId: number;
let mineIssueId: number;

const BASE = "http://localhost";

async function ingestError(p: { id: number; publicKey: string }, message: string) {
  const dsn = `http://${p.publicKey}@localhost/${p.id}`;
  const evt = makeErrorEvent({
    message,
    exception: { values: [{ type: message, value: message }] },
  });
  const res = await postEnvelope(app, p.id, p.publicKey, buildEnvelope("event", evt, dsn));
  expect(res.status).toBe(200);
  const row = await db.select().from(issues).where(eq(issues.projectId, p.id)).all();
  return row.at(-1)!.id;
}

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  ownerToken = await loginToken(app);

  // member da org default + um projeto numa org da qual ele NÃO é membro
  const created = await api(app, ownerToken, "/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "member@test.dev", name: "Member", password: "member123" }),
  });
  expect(created.status).toBe(200);
  memberToken = await loginToken(app, "member@test.dev", "member123");

  const otherOrg = await db
    .insert(orgs)
    .values({ name: "Other", slug: "other", createdAt: Date.now() })
    .returning({ id: orgs.id })
    .get();
  mine = await seedProject("Mine");
  foreign = await seedProject("Foreign", { orgId: otherOrg.id });
  mineIssueId = await ingestError(mine, "MineError");
  foreignIssueId = await ingestError(foreign, "ForeignError");
});

describe("path traversal no BlobStore", () => {
  test("event_id malicioso no envelope não escreve fora de DATA_DIR", async () => {
    const dsn = `http://${mine.publicKey}@localhost/${mine.id}`;
    const payload = "<script>alert(1)</script>";
    const body = [
      JSON.stringify({ event_id: "../../../../pwned", dsn }),
      JSON.stringify({ type: "attachment", filename: "index.html", length: payload.length }),
      payload,
    ].join("\n");
    const res = await postEnvelope(app, mine.id, mine.publicKey, body);
    expect(res.status).toBe(200);

    const root = resolve(DATA_DIR);
    expect(existsSync(join(root, "..", "pwned"))).toBe(false);
    expect(existsSync(resolve(root, "../../../../pwned"))).toBe(false);
    // o anexo foi para um diretório de id aleatório (hex32) dentro do projeto
    const dirs = readdirSync(join(root, String(mine.id), "attachments"));
    expect(dirs.every((d) => /^[0-9a-f]{32}$/.test(d))).toBe(true);
  });
});

describe("decompression bomb / payload inválido", () => {
  test("gzip que expande acima do limite → 413", async () => {
    const bomb = Bun.gzipSync(new Uint8Array(MAX_ENVELOPE_BYTES + 1024));
    expect(bomb.byteLength).toBeLessThan(MAX_ENVELOPE_BYTES / 10);
    const res = await postEnvelope(app, mine.id, mine.publicKey, bomb, {
      "content-encoding": "gzip",
    });
    expect(res.status).toBe(413);
  });

  test("gzip corrompido → 400 (não 500)", async () => {
    const res = await postEnvelope(app, mine.id, mine.publicKey, new Uint8Array([1, 2, 3, 4]), {
      "content-encoding": "gzip",
    });
    expect(res.status).toBe(400);
  });

  test("encoding desconhecido → 400", async () => {
    const res = await postEnvelope(app, mine.id, mine.publicKey, "x", {
      "content-encoding": "lzma",
    });
    expect(res.status).toBe(400);
  });

  test("/store/ também tem limite", async () => {
    const bomb = Bun.gzipSync(new Uint8Array(MAX_ENVELOPE_BYTES + 1024));
    const res = await app.handle(
      new Request(`${BASE}/api/${mine.id}/store/?sentry_key=${mine.publicKey}`, {
        method: "POST",
        headers: { "content-encoding": "gzip" },
        body: bomb,
      }),
    );
    expect(res.status).toBe(413);
  });
});

describe("autorização por projeto (IDOR)", () => {
  test("member não vê projeto de outra org", async () => {
    const list = await json<Array<{ id: number }>>(await api(app, memberToken, "/v1/projects"));
    expect(list.some((p) => p.id === mine.id)).toBe(true);
    expect(list.some((p) => p.id === foreign.id)).toBe(false);
  });

  test("rotas por projeto/recurso de outra org → 404", async () => {
    for (const path of [
      `/v1/projects/${foreign.id}`,
      `/v1/projects/${foreign.id}/issues`,
      `/v1/projects/${foreign.id}/transactions`,
      `/v1/projects/${foreign.id}/replays`,
      `/v1/projects/${foreign.id}/alert-rules`,
      `/v1/projects/${foreign.id}/sourcemaps`,
      `/v1/projects/${foreign.id}/crash-free`,
      `/v1/issues/${foreignIssueId}`,
      `/v1/issues/${foreignIssueId}/events`,
    ]) {
      const res = await api(app, memberToken, path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    // o owner continua enxergando
    expect((await api(app, ownerToken, `/v1/issues/${foreignIssueId}`)).status).toBe(200);
  });

  test("mutação em issue de outra org → 404 e nada muda", async () => {
    const res = await api(app, memberToken, `/v1/issues/${foreignIssueId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(res.status).toBe(404);
    const row = await db.select().from(issues).where(eq(issues.id, foreignIssueId)).get();
    expect(row!.status).toBe("unresolved");
  });

  test("batch ignora ids de projetos inacessíveis", async () => {
    await api(app, memberToken, "/v1/issues/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [foreignIssueId], action: "delete" }),
    });
    expect(await db.select().from(issues).where(eq(issues.id, foreignIssueId)).get()).toBeTruthy();
  });

  test("merge não puxa issue de outro projeto (nem para o owner)", async () => {
    const res = await api(app, ownerToken, `/v1/issues/${mineIssueId}/merge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [foreignIssueId] }),
    });
    expect(res.status).toBe(404);
    const row = await db.select().from(issues).where(eq(issues.id, foreignIssueId)).get();
    expect(row!.mergedInto).toBeNull();
  });

  test("agregados globais só contam projetos visíveis", async () => {
    const stats = await json<{ projects: Array<{ id: number }> }>(
      await api(app, memberToken, "/v1/stats"),
    );
    expect(stats.projects.some((p) => p.id === foreign.id)).toBe(false);
    const recent = await json<Array<{ projectId: number }>>(
      await api(app, memberToken, "/v1/issues?limit=50"),
    );
    expect(recent.some((i) => i.projectId === foreign.id)).toBe(false);
  });

  test("member não altera projeto (owner-only) → 403", async () => {
    const res = await api(app, memberToken, `/v1/projects/${mine.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "hacked" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("identidade por request", () => {
  test("requests concorrentes de usuários diferentes não se misturam", async () => {
    // rota-sonda com o authGuard real e um await entre o guard e a leitura do
    // usuário: com o usuário no `store` global do Elysia, o request lento do
    // owner lia o member que autenticou no meio do caminho
    const probe = new Elysia().onBeforeHandle(authGuard).get("/who", async ({ request }) => {
      await Bun.sleep(Number(request.headers.get("x-delay") ?? 0));
      return currentUser(request).email;
    });
    const who = (token: string, delay: number) =>
      probe
        .handle(
          new Request(`${BASE}/who`, {
            headers: { authorization: `Bearer ${token}`, "x-delay": String(delay) },
          }),
        )
        .then((r) => r.text());
    const slowOwner = who(ownerToken, 40);
    await Bun.sleep(5);
    const fastMember = who(memberToken, 0);
    expect(await fastMember).toBe("member@test.dev");
    expect(await slowOwner).toBe("admin@localhost");
  });
});

describe("webhook de deploy assinado", () => {
  const push = JSON.stringify({ ref: "refs/tags/v9.9.9", commits: [] });

  async function secretOf(projectId: number): Promise<string> {
    const res = await api(app, ownerToken, `/v1/projects/${projectId}/webhook-secret`, {
      method: "POST",
    });
    return (await json<{ webhookSecret: string }>(res)).webhookSecret;
  }

  function hook(projectId: number, headers: Record<string, string> = {}) {
    return app.handle(
      new Request(`${BASE}/v1/webhooks/releases/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: push,
      }),
    );
  }

  test("sem segredo configurado ou sem assinatura → 401", async () => {
    expect((await hook(foreign.id)).status).toBe(401);
    await secretOf(mine.id);
    expect((await hook(mine.id)).status).toBe(401);
    expect((await hook(mine.id, { "x-gitlab-token": "errado" })).status).toBe(401);
  });

  test("GitHub (HMAC) e GitLab (token) válidos → 200", async () => {
    const secret = await secretOf(mine.id);
    const sig = `sha256=${await hmacSha256Hex(secret, new TextEncoder().encode(push))}`;
    expect((await hook(mine.id, { "x-hub-signature-256": sig })).status).toBe(200);
    expect((await hook(mine.id, { "x-gitlab-token": secret })).status).toBe(200);
  });

  test("segredo só aparece para o owner", async () => {
    const asMember = await json<{ webhookSecret?: string }>(
      await api(app, memberToken, `/v1/projects/${mine.id}`),
    );
    expect(asMember.webhookSecret).toBeUndefined();
    const list = await json<Array<Record<string, unknown>>>(
      await api(app, ownerToken, "/v1/projects"),
    );
    expect(list.every((p) => !("webhookSecret" in p))).toBe(true);
  });
});

describe("SSRF em webhooks de alerta", () => {
  function createRule(webhookUrl: string) {
    return api(app, memberToken, `/v1/projects/${mine.id}/alert-rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "r", type: "new_issue", webhookType: "generic", webhookUrl }),
    });
  }

  test("destinos privados/loopback/metadados → 400", async () => {
    for (const url of [
      "http://127.0.0.1:3000/x",
      "http://localhost/x",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/",
      "http://[::1]/",
      "http://2130706433/", // 127.0.0.1 em decimal
      "file:///etc/passwd",
      "http://user:pass@example.com/",
    ]) {
      const res = await createRule(url);
      expect({ url, status: res.status }).toEqual({ url, status: 400 });
    }
  });

  test("destino público é aceito", async () => {
    expect((await createRule("https://hooks.example.com/abc")).status).toBe(200);
  });

  test("/test não segue destino privado nem devolve corpo da resposta", async () => {
    const rule = await db
      .insert(alertRules)
      .values({
        projectId: mine.id,
        name: "legado",
        type: "new_issue",
        config: "{}",
        webhookType: "generic",
        webhookUrl: "http://127.0.0.1:1/",
        enabled: 1,
        createdAt: Date.now(),
      })
      .returning({ id: alertRules.id })
      .get();
    const res = await json<{ ok: boolean; body: string }>(
      await api(app, memberToken, `/v1/alerts/${rule.id}/test`, { method: "POST" }),
    );
    expect(res.ok).toBe(false);
    expect(res.body).toStartWith("bloqueado");
  });
});

describe("credenciais", () => {
  test("tokens de sessão e de API ficam em hash no banco", async () => {
    const rows = await db.select().from(sessions).all();
    expect(rows.some((r) => r.token === ownerToken)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.token))).toBe(true);

    const created = await json<{ token: string }>(
      await api(app, ownerToken, "/v1/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ci" }),
      }),
    );
    const stored = await db.select().from(apiTokens).all();
    expect(stored.some((r) => r.token === created.token)).toBe(false);
    // o token cru continua autenticando
    expect((await api(app, created.token, "/v1/auth/me")).status).toBe(200);
    // e a listagem não expõe a coluna token
    const list = await json<Array<Record<string, unknown>>>(
      await api(app, ownerToken, "/v1/api-tokens"),
    );
    expect(list.every((t) => !("token" in t))).toBe(true);
  });

  test("brute force de login → 429 após 10 falhas (mesmo com a senha certa)", async () => {
    const attempt = (password: string) =>
      app.handle(
        new Request(`${BASE}/v1/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "member@test.dev", password }),
        }),
      );
    for (let i = 0; i < 10; i++) expect((await attempt("errada")).status).toBe(401);
    const blocked = await attempt("member123");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
