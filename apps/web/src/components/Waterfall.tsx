import type { Span, TransactionDetail } from "@sentrylike/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const OP_COLORS: Record<string, string> = {
  http: "bg-sky-500/80",
  db: "bg-amber-500/80",
  "db.query": "bg-amber-500/80",
  "db.redis": "bg-orange-500/80",
  ui: "bg-violet-500/80",
  "ui.load": "bg-violet-500/80",
  "ui.interaction": "bg-fuchsia-500/80",
  function: "bg-emerald-500/80",
  pageload: "bg-indigo-500/80",
  navigation: "bg-cyan-500/80",
  resource: "bg-teal-500/80",
  render: "bg-pink-500/80",
};

function opColor(op: string | null): string {
  if (op && OP_COLORS[op]) return OP_COLORS[op];
  if (op?.startsWith("db")) return OP_COLORS["db"];
  return "bg-primary/70";
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** Waterfall de spans — a transaction raiz é sintetizada como span 0. */
export function Waterfall({ transaction }: { transaction: TransactionDetail }) {
  const t0 = transaction.timestamp;
  const total = Math.max(transaction.duration, 1);
  const root: Span = {
    id: transaction.spanId ?? "root",
    transactionId: transaction.id,
    traceId: transaction.traceId,
    parentSpanId: null,
    op: "transaction",
    description: transaction.name,
    startTimestamp: t0,
    endTimestamp: t0 + transaction.duration,
    duration: transaction.duration,
    status: transaction.status,
  };
  const rows = [root, ...transaction.spans]
    .filter((s) => s.duration != null && s.duration > 0)
    .toSorted((a, b) => (a.startTimestamp ?? 0) - (b.startTimestamp ?? 0));

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Waterfall</span>
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {transaction.name} · {fmtMs(transaction.duration)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        <div className="flex items-center gap-3 border-b px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="w-44 shrink-0">Span</span>
          <span className="flex-1">Timeline ({fmtMs(total)})</span>
          <span className="w-14 shrink-0 text-right">Dur.</span>
        </div>
        {rows.map((s, i) => {
          const left = s.startTimestamp != null ? ((s.startTimestamp - t0) / total) * 100 : 0;
          const width = Math.min(100 - Math.max(left, 0), ((s.duration ?? 0) / total) * 100);
          const isRoot = i === 0;
          return (
            <div
              key={s.id}
              className={`flex items-center gap-3 px-4 py-1.5 text-xs ${
                isRoot ? "bg-muted/30" : ""
              } ${i % 2 === 0 ? "bg-background" : "bg-muted/10"}`}
            >
              <div className="w-44 shrink-0 truncate" title={s.description ?? undefined}>
                <span className="font-mono text-muted-foreground">{s.op ?? "span"}</span>
                {s.description && (
                  <span className="ml-1.5 text-foreground/85">{s.description}</span>
                )}
              </div>
              <div className="relative h-5 flex-1">
                <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                <div
                  className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm ${opColor(s.op)} ${
                    s.status && s.status !== "ok" ? "opacity-90 ring-1 ring-destructive" : ""
                  }`}
                  style={{ left: `${Math.max(left, 0)}%`, width: `${Math.max(width, 0.4)}%` }}
                  title={`${s.op ?? "span"} ${s.description ?? ""} ${fmtMs(s.duration)}`}
                />
              </div>
              <div className="w-14 shrink-0 text-right font-mono text-muted-foreground">
                {fmtMs(s.duration)}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">sem spans nessa transação</p>
        )}
        <div className="flex items-center gap-2 border-t px-4 py-2 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[9px]">
            {transaction.status}
          </Badge>
          <span className="font-mono">
            trace: {(transaction.traceId ?? "—").slice(0, 16)}
            {transaction.traceId ? "…" : ""}
          </span>
          <span className="ml-auto font-mono">
            {transaction.browser ? `browser: ${transaction.browser}` : ""}
            {transaction.country ? ` · ${transaction.country}` : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
