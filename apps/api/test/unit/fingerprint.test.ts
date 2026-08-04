import { describe, expect, test } from "bun:test";
import { computeFingerprint } from "../../src/lib/fingerprint";
import type { SentryEvent } from "@sentrylike/shared";

/** Evento com type de exceção escolhido (fingerprints diferentes). */
function withType(type: string): SentryEvent {
  return {
    exception: {
      values: [
        { type, stacktrace: { frames: [{ filename: "a.js", function: "f", in_app: true }] } },
      ],
    },
  } as SentryEvent;
}

describe("computeFingerprint", () => {
  test("fingerprint custom do SDK tem prioridade", async () => {
    const a = await computeFingerprint({ fingerprint: ["meu-grupo"] } as SentryEvent);
    const b = await computeFingerprint({ fingerprint: ["meu-grupo"] } as SentryEvent);
    expect(a).toBe(b);

    const c = await computeFingerprint({ fingerprint: ["outro"] } as SentryEvent);
    expect(c).not.toBe(a);
  });

  test("mesmos frames in-app → mesmo fingerprint (agrupa na mesma issue)", async () => {
    const evt = {
      exception: {
        values: [
          {
            type: "TypeError",
            stacktrace: {
              frames: [
                { filename: "app.js", function: "main", in_app: true },
                { filename: "a.js", function: "f", in_app: true },
              ],
            },
          },
        ],
      },
    } as SentryEvent;
    const a = await computeFingerprint(evt);
    const b = await computeFingerprint({ ...evt } as SentryEvent);
    expect(a).toBe(b);
  });

  test("frames in-app diferentes → fingerprints diferentes", async () => {
    const base = {
      exception: { values: [{ type: "TypeError", stacktrace: { frames: [] } }] },
    } as SentryEvent;
    const a = await computeFingerprint({
      ...base,
      exception: {
        values: [
          {
            type: "TypeError",
            stacktrace: { frames: [{ filename: "x.js", function: "f", in_app: true }] },
          },
        ],
      },
    } as SentryEvent);
    const b = await computeFingerprint({
      ...base,
      exception: {
        values: [
          {
            type: "TypeError",
            stacktrace: { frames: [{ filename: "y.js", function: "f", in_app: true }] },
          },
        ],
      },
    } as SentryEvent);
    expect(a).not.toBe(b);
  });

  test("sem frames in-app usa os últimos 5 frames (crashing frame fica por último)", async () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({
      filename: `lib${i}.js`,
      function: `fn${i}`,
      in_app: false,
    }));
    const fp = await computeFingerprint({
      exception: { values: [{ type: "Error", stacktrace: { frames } }] },
    } as SentryEvent);
    const fpSame = await computeFingerprint({
      exception: { values: [{ type: "Error", stacktrace: { frames: [...frames] } }] },
    } as SentryEvent);
    expect(fp).toBe(fpSame);
  });

  test("sem stacktrace usa a mensagem", async () => {
    const a = await computeFingerprint({ message: "erro fixo" } as SentryEvent);
    const b = await computeFingerprint({ message: "erro fixo" } as SentryEvent);
    expect(a).toBe(b);

    const c = await computeFingerprint({ message: "outra coisa" } as SentryEvent);
    expect(c).not.toBe(a);
  });

  test("exception type diferente muda o fingerprint", async () => {
    expect(await computeFingerprint(withType("TypeError"))).not.toBe(
      await computeFingerprint(withType("RangeError")),
    );
  });
});
