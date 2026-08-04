import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("hashPassword / verifyPassword", () => {
  test("roundtrip: hash → verify ok", async () => {
    const hash = await hashPassword("minha-senha");
    expect(hash.startsWith("pbkdf2:")).toBe(true);
    expect(await verifyPassword("minha-senha", hash)).toBe(true);
  });

  test("senha errada → false", async () => {
    const hash = await hashPassword("certa");
    expect(await verifyPassword("errada", hash)).toBe(false);
  });

  test("hashes são salgados (mesma senha, hashes diferentes)", async () => {
    const a = await hashPassword("senha");
    const b = await hashPassword("senha");
    expect(a).not.toBe(b);
    expect(await verifyPassword("senha", a)).toBe(true);
    expect(await verifyPassword("senha", b)).toBe(true);
  });

  test("formato inválido → false (sem crash)", async () => {
    expect(await verifyPassword("x", "não é hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2:100000:aa:bb:extra")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});
