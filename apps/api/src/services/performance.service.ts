import { and, asc, desc, eq, gt, isNotNull, like, sql } from "drizzle-orm";
import type {
  DayStat,
  ReleasePerformance,
  Span,
  Transaction,
  TransactionDetail,
  TransactionSummary,
  VitalsMap,
} from "@sentrylike/shared";
import { db } from "../db";
import { projects, spans, transactions } from "../db/schema";

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

/** Percentil sobre valores ordenados (sem percentile nativo no SQLite). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function rowToTransaction(r: typeof transactions.$inferSelect): Transaction {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    timestamp: r.timestamp,
    duration: r.duration,
    status: r.status,
    release: r.release,
    environment: r.environment,
    platform: r.platform,
    browser: r.browser,
    country: r.country,
    traceId: r.traceId,
    spanId: r.spanId,
    parentSpanId: r.parentSpanId,
    measurements: r.measurements ? JSON.parse(r.measurements) : null,
  };
}

export type PerfFilters = {
  release?: string;
  env?: string;
  q?: string;
  days?: number;
};

function perfConds(projectId: number, f: PerfFilters) {
  const conds = [eq(transactions.projectId, projectId)];
  if (f.release) conds.push(eq(transactions.release, f.release));
  if (f.env) conds.push(eq(transactions.environment, f.env));
  if (f.q) conds.push(like(transactions.name, `%${f.q.trim()}%`));
  return conds;
}

// ------------------------------------------------------------------
// listagens
// ------------------------------------------------------------------

/** Resumo agregado por nome de transaction (p50/p95/p99, erro, throughput). */
export function transactionSummaries(projectId: number, f: PerfFilters): TransactionSummary[] {
  const rows = db
    .select({
      name: transactions.name,
      timestamp: transactions.timestamp,
      duration: transactions.duration,
      status: transactions.status,
    })
    .from(transactions)
    .where(and(...perfConds(projectId, f)))
    .all();

  const groups = new Map<
    string,
    { durations: number[]; errors: number; first: number; last: number }
  >();
  for (const r of rows) {
    let g = groups.get(r.name);
    if (!g) {
      g = { durations: [], errors: 0, first: r.timestamp, last: r.timestamp };
      groups.set(r.name, g);
    }
    g.durations.push(r.duration);
    if (r.status !== "ok") g.errors++;
    g.first = Math.min(g.first, r.timestamp);
    g.last = Math.max(g.last, r.timestamp);
  }

  return [...groups.entries()]
    .map(([name, g]) => {
      const sorted = [...g.durations].toSorted((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const hours = Math.max((g.last - g.first) / 3_600_000, 1 / 60); // no mínimo 1 min
      return {
        name,
        count: g.durations.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        avg: Math.round(sum / sorted.length),
        errorCount: g.errors,
        errorRate: g.errors / sorted.length,
        firstSeen: g.first,
        lastSeen: g.last,
        throughput: Math.round((g.durations.length / hours) * 10) / 10,
      };
    })
    .toSorted((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 200);
}

/** Transactions recentes (para a listagem do detalhe). */
export function recentTransactions(projectId: number, f: PerfFilters, limit = 100): Transaction[] {
  return db
    .select()
    .from(transactions)
    .where(and(...perfConds(projectId, f)))
    .orderBy(desc(transactions.timestamp))
    .limit(limit)
    .all()
    .map(rowToTransaction);
}

/** Série diária (count + latência média) de uma transaction. */
export function transactionSeries(
  projectId: number,
  name: string,
  f: PerfFilters,
  days = 14,
): DayStat[] {
  const now = Date.now();
  const since = now - days * 24 * 3600_000;
  const conds = [
    eq(transactions.projectId, projectId),
    eq(transactions.name, name),
    gt(transactions.timestamp, since),
  ];
  if (f.release) conds.push(eq(transactions.release, f.release));
  if (f.env) conds.push(eq(transactions.environment, f.env));

  const rows = db
    .select({
      date: sql<string>`date(timestamp / 1000, 'unixepoch')`,
      count: sql<number>`count(*)`,
      avg: sql<number>`avg(${transactions.duration})`,
    })
    .from(transactions)
    .where(and(...conds))
    .groupBy(sql`date(timestamp / 1000, 'unixepoch')`)
    .orderBy(asc(sql`date(timestamp / 1000, 'unixepoch')`))
    .all();

  // preenche dias vazios
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: DayStat[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now - (days - 1 - i) * 24 * 3600_000);
    const key = d.toISOString().slice(0, 10);
    const r = byDate.get(key);
    out.push({ date: key, count: r?.count ?? 0, avg: Math.round(r?.avg ?? 0) });
  }
  return out;
}

/** Detalhe de uma transaction + spans para o waterfall. */
export function getTransaction(id: string): TransactionDetail | undefined {
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) return undefined;
  const spanRows = db
    .select()
    .from(spans)
    .where(eq(spans.transactionId, id))
    .orderBy(asc(spans.startTimestamp))
    .all();
  const spanList: Span[] = spanRows.map((s) => ({
    id: s.id,
    transactionId: s.transactionId,
    traceId: s.traceId,
    parentSpanId: s.parentSpanId,
    op: s.op,
    description: s.description,
    startTimestamp: s.startTimestamp,
    endTimestamp: s.endTimestamp,
    duration: s.duration,
    status: s.status,
  }));
  return { ...rowToTransaction(row), spans: spanList };
}

// ------------------------------------------------------------------
// métricas agregadas
// ------------------------------------------------------------------

/** Resumo global: rotas de todos os projetos (janela de 7 dias). */
export function globalSummaries(days = 7): TransactionSummary[] {
  const since = Date.now() - days * 24 * 3600_000;
  const projectNames = new Map(
    db
      .select()
      .from(projects)
      .all()
      .map((p) => [p.id, p.name]),
  );
  const rows = db
    .select({
      projectId: transactions.projectId,
      name: transactions.name,
      timestamp: transactions.timestamp,
      duration: transactions.duration,
      status: transactions.status,
    })
    .from(transactions)
    .where(gt(transactions.timestamp, since))
    .all();

  const groups = new Map<
    string,
    { durations: number[]; errors: number; first: number; last: number }
  >();
  for (const r of rows) {
    const key = `${r.projectId}:${r.name}`;
    let g = groups.get(key);
    if (!g) {
      g = { durations: [], errors: 0, first: r.timestamp, last: r.timestamp };
      groups.set(key, g);
    }
    g.durations.push(r.duration);
    if (r.status !== "ok") g.errors++;
    g.first = Math.min(g.first, r.timestamp);
    g.last = Math.max(g.last, r.timestamp);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      const [projectId, name] = key.split(":");
      const sorted = [...g.durations].toSorted((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const hours = Math.max((g.last - g.first) / 3_600_000, 1 / 60);
      return {
        name,
        count: g.durations.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        avg: Math.round(sum / sorted.length),
        errorCount: g.errors,
        errorRate: g.errors / sorted.length,
        firstSeen: g.first,
        lastSeen: g.last,
        throughput: Math.round((g.durations.length / hours) * 10) / 10,
        // projectId + projectName extras para o front agrupar
        projectId: Number(projectId),
        projectName: projectNames.get(Number(projectId)) ?? `#${projectId}`,
      } as TransactionSummary & { projectId: number; projectName: string };
    })
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 200);
}

const VITAL_KEYS = ["lcp", "fcp", "cls", "ttfb", "inp", "fp"] as const;

/** Web vitals agregados (p50/p75/p95) das transactions que trazem measurements. */
export function webVitals(projectId: number, f: PerfFilters): VitalsMap {
  const conds = [...perfConds(projectId, f), isNotNull(transactions.measurements)];
  const rows = db
    .select({ measurements: transactions.measurements })
    .from(transactions)
    .where(and(...conds))
    .all();

  const values = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.measurements) continue;
    let parsed: Record<string, { value?: number }> = {};
    try {
      parsed = JSON.parse(r.measurements);
    } catch {
      continue;
    }
    for (const key of VITAL_KEYS) {
      const v = parsed[key]?.value;
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        if (!values.has(key)) values.set(key, []);
        values.get(key)!.push(v);
      }
    }
  }

  const out: VitalsMap = {};
  for (const key of VITAL_KEYS) {
    const arr = values.get(key);
    if (!arr?.length) continue;
    const sorted = [...arr].toSorted((a, b) => a - b);
    out[key] = {
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p95: percentile(sorted, 95),
      count: arr.length,
    };
  }
  return out;
}

/** Comparativo de performance por release. */
export function releasePerformance(projectId: number, f: PerfFilters): ReleasePerformance[] {
  const rows = db
    .select({
      release: transactions.release,
      timestamp: transactions.timestamp,
      duration: transactions.duration,
      status: transactions.status,
    })
    .from(transactions)
    .where(and(...perfConds(projectId, f), isNotNull(transactions.release)))
    .all();

  const groups = new Map<string, { durations: number[]; errors: number; last: number }>();
  for (const r of rows) {
    if (!r.release) continue;
    let g = groups.get(r.release);
    if (!g) {
      g = { durations: [], errors: 0, last: r.timestamp };
      groups.set(r.release, g);
    }
    g.durations.push(r.duration);
    if (r.status !== "ok") g.errors++;
    g.last = Math.max(g.last, r.timestamp);
  }

  return [...groups.entries()]
    .map(([release, g]) => {
      const sorted = [...g.durations].toSorted((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      return {
        release,
        count: g.durations.length,
        avg: Math.round(sum / sorted.length),
        p95: percentile(sorted, 95),
        errorRate: g.errors / sorted.length,
        lastSeen: g.last,
      };
    })
    .toSorted((a, b) => b.lastSeen - a.lastSeen);
}
