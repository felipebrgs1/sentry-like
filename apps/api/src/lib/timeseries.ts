import type { DayCount } from "@sentrylike/shared";

export interface DayRow {
  day: string;
  count: number;
}

/** Preenche os dias que não tiveram eventos com zero, da mais antiga à mais recente. */
export function fillDays(rows: DayRow[], now: number, days: number): DayCount[] {
  const map = new Map(rows.map((r) => [r.day, r.count]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now - (days - 1 - i) * 24 * 3600 * 1000);
    const date = d.toISOString().slice(0, 10);
    return { date, count: map.get(date) ?? 0 };
  });
}
