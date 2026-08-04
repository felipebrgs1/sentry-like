import { describe, expect, test } from "bun:test";
import { parseEnvelope } from "../../src/lib/envelope";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseEnvelope", () => {
  test("parseia envelope com 1 item (header + header do item + payload com length)", () => {
    const payload = JSON.stringify({ message: "x" });
    const raw = enc(
      [
        JSON.stringify({ event_id: "abc", dsn: "http://key@host/1" }),
        JSON.stringify({ type: "event", content_type: "application/json", length: payload.length }),
        payload,
      ].join("\n"),
    );
    const env = parseEnvelope(raw);
    expect(env.header.event_id).toBe("abc");
    expect(env.items).toHaveLength(1);
    expect(env.items[0].header.type).toBe("event");
    expect(new TextDecoder().decode(env.items[0].payload)).toBe(payload);
  });

  test("multi-item (event + attachment) respeita os lengths de cada um", () => {
    const evt = JSON.stringify({ message: "erro" });
    const att = "binary-data";
    const raw = enc(
      [
        JSON.stringify({ event_id: "abc" }),
        JSON.stringify({ type: "event", length: evt.length }),
        evt,
        JSON.stringify({ type: "attachment", length: att.length, filename: "a.txt" }),
        att,
      ].join("\n"),
    );
    const env = parseEnvelope(raw);
    expect(env.items).toHaveLength(2);
    expect(env.items[0].header.type).toBe("event");
    expect(env.items[1].header.type).toBe("attachment");
    expect(env.items[1].header.filename).toBe("a.txt");
    expect(new TextDecoder().decode(env.items[1].payload)).toBe(att);
  });

  test("payload sem length vai até a próxima quebra de linha", () => {
    const raw = enc(
      [
        JSON.stringify({ event_id: "abc" }),
        JSON.stringify({ type: "event" }),
        "payload-simples",
      ].join("\n"),
    );
    const env = parseEnvelope(raw);
    expect(env.items).toHaveLength(1);
    expect(new TextDecoder().decode(env.items[0].payload)).toBe("payload-simples");
  });

  test("payload com quebra de linha interna e length preserva o conteúdo (payload é binário)", () => {
    const payload = "linha1\nlinha2\n";
    const raw = enc(
      [
        JSON.stringify({ event_id: "abc" }),
        JSON.stringify({ type: "event", length: payload.length }),
        payload,
      ].join("\n"),
    );
    const env = parseEnvelope(raw);
    expect(new TextDecoder().decode(env.items[0].payload)).toBe(payload);
  });

  test("envelope vazio lança erro", () => {
    expect(() => parseEnvelope(enc("\n"))).toThrow("empty envelope");
  });

  test("header não-JSON lança erro", () => {
    expect(() => parseEnvelope(enc("não é json\n{...}"))).toThrow();
  });

  test("linhas em branco ANTES do header do item são toleradas", () => {
    const evt = JSON.stringify({ message: "x" });
    const raw = enc(
      [
        JSON.stringify({ event_id: "abc" }),
        "",
        JSON.stringify({ type: "event", length: evt.length }),
        evt,
      ].join("\n"),
    );
    const env = parseEnvelope(raw);
    expect(env.items).toHaveLength(1);
    expect(env.header.event_id).toBe("abc");
    expect(new TextDecoder().decode(env.items[0].payload)).toBe(evt);
  });
});
