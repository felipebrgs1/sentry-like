/**
 * Integração: autenticação (sessão, API tokens, 2FA) e usuários.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { TestApp } from "../helpers";
import { api, createTestApp, initTestDb, json, loginToken } from "../helpers";

// implementação de referência do TOTP (RFC 6238) para gerar códigos válidos
async function totpCode(secret: string, counterOffset = 0): Promise<string> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const c of clean) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const key = Uint8Array.from(bytes);
  let counter = Math.floor(Date.now() / 30_000) + counterOffset;
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    msg[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as Uint8Array<ArrayBuffer>,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, msg as unknown as Uint8Array<ArrayBuffer>),
  );
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

let app: TestApp;
let adminToken: string;

beforeAll(async () => {
  await initTestDb();
  app = createTestApp();
  adminToken = await loginToken(app);
});

describe("login", () => {
  test("credenciais erradas → 401", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "errada" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("credenciais certas → token + usuário", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "senha123" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ token: string; user: { email: string; isOwner: number } }>(res);
    expect(typeof body.token).toBe("string");
    expect(body.user.email).toBe("admin@localhost");
    expect(body.user.isOwner).toBe(1);
  });

  test("setup-status: owner já existe (bootstrap por env)", async () => {
    const res = await app.handle(new Request("http://localhost/v1/auth/setup-status"));
    expect(await json<{ needsSetup: boolean }>(res)).toEqual({ needsSetup: false });
  });
});

describe("sessão", () => {
  test("rotas protegidas sem token → 401", async () => {
    const res = await app.handle(new Request("http://localhost/v1/projects"));
    expect(res.status).toBe(401);
  });

  test("token inválido → 401", async () => {
    const res = await api(app, "token-invalido", "/v1/projects");
    expect(res.status).toBe(401);
  });

  test("/v1/auth/me devolve o usuário logado", async () => {
    const res = await api(app, adminToken, "/v1/auth/me");
    expect(res.status).toBe(200);
    const body = await json<{ user: { name: string } }>(res);
    expect(body.user.name).toBe("admin");
  });

  test("logout invalida o token", async () => {
    const token = await loginToken(app);
    const out = await api(app, token, "/v1/auth/logout", { method: "POST" });
    expect(out.status).toBe(200);
    const me = await api(app, token, "/v1/auth/me");
    expect(me.status).toBe(401);
  });
});

describe("change-password", () => {
  test("senha atual errada → 400", async () => {
    const res = await api(app, adminToken, "/v1/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "errada", newPassword: "nova123" }),
    });
    expect(res.status).toBe(400);
  });

  test("troca com sucesso e nova senha passa a funcionar", async () => {
    const res = await api(app, adminToken, "/v1/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "senha123", newPassword: "nova123" }),
    });
    expect(res.status).toBe(200);

    // volta para a original para não quebrar os demais testes do arquivo
    await api(app, adminToken, "/v1/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "nova123", newPassword: "senha123" }),
    });
    const relogin = await loginToken(app);
    expect(typeof relogin).toBe("string");
  });
});

describe("usuários (owner)", () => {
  test("cria usuário e lista", async () => {
    const created = await api(app, adminToken, "/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dev@example.com", name: "Dev", password: "senha123" }),
    });
    expect(created.status).toBe(200);
    const user = await json<{ id: number; email: string; isOwner: number }>(created);
    expect(user.email).toBe("dev@example.com");
    expect(user.isOwner).toBe(0);

    const list = await api(app, adminToken, "/v1/users");
    expect(
      (await json<Array<{ email: string }>>(list)).some((u) => u.email === "dev@example.com"),
    ).toBe(true);
  });

  test("email duplicado → 409", async () => {
    const res = await api(app, adminToken, "/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dev@example.com", name: "Outro", password: "senha123" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("API tokens", () => {
  test("cria token e usa no lugar da sessão", async () => {
    const created = await api(app, adminToken, "/v1/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ci" }),
    });
    expect(created.status).toBe(200);
    const { token, id } = await json<{ token: string; id: number }>(created);
    expect(token.startsWith("sentrylike_")).toBe(true);

    const res = await api(app, token, "/v1/projects");
    expect(res.status).toBe(200);

    // revoga
    const del = await api(app, adminToken, `/v1/api-tokens/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await api(app, token, "/v1/projects");
    expect(after.status).toBe(401);
  });
});

describe("2FA (TOTP)", () => {
  let totpUserToken = "";

  test("fluxo completo em um usuário dedicado", async () => {
    const created = await api(app, adminToken, "/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "totp@example.com", name: "Totp", password: "senha123" }),
    });
    const user = await json<{ id: number }>(created);
    expect(user.id).toBeGreaterThan(0);

    totpUserToken = await loginToken(app, "totp@example.com");

    // enable → segredo + URI
    const enabled = await api(app, totpUserToken, "/v1/auth/2fa/enable", { method: "POST" });
    expect(enabled.status).toBe(200);
    const { secret, uri } = await json<{ secret: string; uri: string }>(enabled);
    expect(uri).toContain("otpauth://totp/");

    // confirm com código errado → 400
    const wrong = await api(app, totpUserToken, "/v1/auth/2fa/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(wrong.status).toBe(400);

    // confirm com código certo → ativa
    const ok = await api(app, totpUserToken, "/v1/auth/2fa/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: await totpCode(secret) }),
    });
    expect(ok.status).toBe(200);

    // login agora EXIGE o código
    const withoutCode = await app.handle(
      new Request("http://localhost/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "totp@example.com", password: "senha123" }),
      }),
    );
    expect(withoutCode.status).toBe(401);

    const withCode = await app.handle(
      new Request("http://localhost/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "totp@example.com",
          password: "senha123",
          totpCode: await totpCode(secret),
        }),
      }),
    );
    expect(withCode.status).toBe(200);

    // disable com código → volta ao normal
    const disabled = await api(app, totpUserToken, "/v1/auth/2fa/disable", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: await totpCode(secret) }),
    });
    expect(disabled.status).toBe(200);

    const relogin = await loginToken(app, "totp@example.com");
    expect(typeof relogin).toBe("string");
  });
});
