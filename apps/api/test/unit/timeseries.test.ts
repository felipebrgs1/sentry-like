import { describe, expect, test } from "bun:test";
import { fillDays } from "../../src/lib/timeseries";

describe("fillDays", () => {
  test("preenche dias sem eventos com zero (mais antiga → mais recente)", () => {
    const now = new Date("2025-01-10T12:00:00Z").getTime();
    const rows = [{ day: "2025-01-08", count: 3 }];
    const out = fillDays(rows, now, 5);
    expect(out).toHaveLength(5);
    expect(out.map((d) => d.date)).toEqual([
      "2025-01-06",
      "2025-01-07",
      "2025-01-08",
      "2025-01-09",
      "2025-01-10",
    ]);
    expect(out.map((d) => d.count)).toEqual([0, 0, 3, 0, 0]);
  });

  test("dia repetido nos rows: o Map mantém o último valor", () => {
    const now = new Date("2025-01-02T00:00:00Z").getTime();
    const out = fillDays(
      [
        { day: "2025-01-01", count: 2 },
        { day: "2025-01-01", count: 1 },
      ],
      now,
      2,
    );
    expect(out[0]).toEqual({ date: "2025-01-01", count: 1 });
    expect(out[1]).toEqual({ date: "2025-01-02", count: 0 });
  });

  test("ordena independente da ordem dos rows", () => {
    const now = new Date("2025-01-03T00:00:00Z").getTime();
    const out = fillDays([{ day: "2025-01-01", count: 1 }], now, 3);
    expect(out[0]).toEqual({ date: "2025-01-01", count: 1 });
    expect(out[1]).toEqual({ date: "2025-01-02", count: 0 });
    expect(out[2]).toEqual({ date: "2025-01-03", count: 0 });
  });
});
