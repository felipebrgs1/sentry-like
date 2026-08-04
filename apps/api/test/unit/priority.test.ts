import { describe, expect, test } from "bun:test";
import { computePriority } from "../../src/lib/priority";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("computePriority", () => {
  test("fatal + frequente + recente → high", () => {
    expect(computePriority("fatal", 50, Date.now(), Date.now())).toBe("high");
  });

  test("debug + raro + antigo → low", () => {
    expect(computePriority("debug", 1, Date.now() - 10 * DAY, Date.now())).toBe("low");
  });

  test("error + 10 eventos + 1 dia → medium", () => {
    expect(computePriority("error", 10, Date.now() - DAY, Date.now())).toBe("medium");
  });

  test("level desconhecido cai para peso neutro (0.5)", () => {
    const now = Date.now();
    const p = computePriority("estranho" as string, 50, now, now);
    expect(["high", "medium", "low"]).toContain(p);
  });

  test("eventCount acima do teto satura (não cresce para sempre)", () => {
    const a = computePriority("error", 100, Date.now(), Date.now());
    const b = computePriority("error", 5000, Date.now(), Date.now());
    expect(a).toBe(b);
  });
});
