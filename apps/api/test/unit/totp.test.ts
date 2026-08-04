import { describe, expect, test } from "bun:test";
import { generateTotpSecret, provisioningUri, verifyTotp } from "../../src/lib/totp";

// Implementação de REFERÊNCIA do RFC 6238 (HMAC-SHA1, 6 dígitos, janela 30s),
// independente da implementação sob teste — validação cruzada.
async function referenceTotp(secretB32: string, counter: number): Promise<string> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretB32.toUpperCase().replace(/[^A-Z2-7]/g, "");
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

describe("TOTP", () => {
  test("generateTotpSecret devolve 32 chars do alfabeto base32", () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  test("verifyTotp aceita o código da implementação de referência (janela atual)", async () => {
    const secret = generateTotpSecret();
    const counter = Math.floor(Date.now() / 30_000);
    const code = await referenceTotp(secret, counter);
    expect(await verifyTotp(secret, code)).toBe(true);
  });

  test("verifyTotp aceita código da janela anterior (±1 janela de tolerância)", async () => {
    const secret = generateTotpSecret();
    const counter = Math.floor(Date.now() / 30_000) - 1;
    const code = await referenceTotp(secret, counter);
    expect(await verifyTotp(secret, code)).toBe(true);
  });

  test("verifyTotp rejeita código muito antigo/futuro", async () => {
    const secret = generateTotpSecret();
    const counter = Math.floor(Date.now() / 30_000) + 10; // 5min no futuro
    const code = await referenceTotp(secret, counter);
    expect(await verifyTotp(secret, code)).toBe(false);
  });

  test("verifyTotp rejeita formato inválido e segredo errado", async () => {
    expect(await verifyTotp(generateTotpSecret(), "12345")).toBe(false); // 5 dígitos
    expect(await verifyTotp(generateTotpSecret(), "abcdef")).toBe(false); // não numérico
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    const counter = Math.floor(Date.now() / 30_000);
    const codeA = await referenceTotp(a, counter);
    expect(await verifyTotp(b, codeA)).toBe(false);
  });

  test("provisioningUri tem formato otpauth:// com o issuer", () => {
    const uri = provisioningUri("SECRET", "user@example.com");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("issuer=sentrylike");
    expect(uri).toContain("secret=SECRET");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
