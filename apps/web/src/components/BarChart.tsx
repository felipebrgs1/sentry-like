import type { DayCount } from "@sentrylike/shared";

/** Gráfico de barras leve (CSS puro, sem lib) no estilo Sentry. */
export function BarChart({ data, className }: { data: DayCount[]; className?: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className={`flex h-36 items-end gap-[3px] ${className ?? ""}`}>
      {data.map((d, i) => (
        <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
          <div
            className="min-h-[2px] w-full rounded-t-sm bg-gradient-to-t from-primary/50 to-primary/90 transition-all group-hover:from-primary/80 group-hover:to-primary"
            style={{ height: `${Math.max((d.count / max) * 100, 2)}%` }}
          />
          <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded border bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap shadow group-hover:block">
            {d.date.slice(5)}: {d.count}
          </span>
          {i % 2 === 1 && (
            <span className="mt-1 text-center font-mono text-[9px] text-muted-foreground/70">
              {d.date.slice(8)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
