import { describe, expect, test } from "bun:test";
import { parseDsn, validateEvent } from "../../src/lib/validate";

describe("validateEvent", () => {
  test("aceita evento mínimo com message", () => {
    const res = validateEvent({ message: "olá" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.event.level).toBe("error");
  });

  test("rejeita não-objeto", () => {
    expect(validateEvent(null).ok).toBe(false);
    expect(validateEvent("str").ok).toBe(false);
    expect(validateEvent(42).ok).toBe(false);
    expect(validateEvent([]).ok).toBe(false);
  });

  test("rejeita evento sem conteúdo", () => {
    const res = validateEvent({ event_id: "abc" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("no message");
  });

  test("rejeita event_id não-string", () => {
    const res = validateEvent({ event_id: 123, message: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("event_id");
  });

  test("rejeita exception.values não-array", () => {
    const res = validateEvent({ exception: { values: "nope" }, message: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("values");
  });

  test("rejeita timestamp inválido", () => {
    const res = validateEvent({ message: "x", timestamp: "não é data" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("timestamp");
  });

  test("aceita timestamp numérico (epoch segundos)", () => {
    const res = validateEvent({ message: "x", timestamp: 1_700_000_000 });
    expect(res.ok).toBe(true);
  });

  test("normaliza level: inválido vira error, maiúsculo vira minúsculo", () => {
    const a = validateEvent({ message: "x", level: "WARNING" });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.event.level).toBe("warning");

    const b = validateEvent({ message: "x", level: "garbage" });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.event.level).toBe("error");
  });
});

describe("parseDsn", () => {
  test("extrai key e projectId de DSN com path", () => {
    const d = parseDsn("http://abcd1234@example.com/api/1");
    expect(d).toEqual({ publicKey: "abcd1234", projectId: 1 });
  });

  test("extrai de DSN com multi-segment path", () => {
    const d = parseDsn("https://key@host.com/sentry/projects/42");
    expect(d).toEqual({ publicKey: "key", projectId: 42 });
  });

  test("rejeita DSN sem key ou sem id", () => {
    expect(parseDsn("http://host.com/1")).toBeNull();
    expect(parseDsn("http://key@host.com/abc")).toBeNull();
    expect(parseDsn("não é dsn")).toBeNull();
  });
});
