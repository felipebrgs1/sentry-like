import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Gauge, Search, Trash2 } from "lucide-react";
import type {
  DayStat,
  ReleasePerformance,
  Transaction,
  TransactionDetail,
  TransactionSummary,
  VitalsMap,
} from "@sentrylike/shared";
import { api } from "../api";
import { Waterfall } from "../components/Waterfall";
import { BarChart } from "../components/BarChart";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const VITAL_META: Array<{ key: keyof VitalsMap; label: string; unit: string; good: number }> = [
  { key: "lcp", label: "LCP", unit: "ms", good: 2500 },
  { key: "fcp", label: "FCP", unit: "ms", good: 1800 },
  { key: "cls", label: "CLS", unit: "", good: 0.1 },
  { key: "ttfb", label: "TTFB", unit: "ms", good: 800 },
  { key: "inp", label: "INP", unit: "ms", good: 200 },
  { key: "fp", label: "FP", unit: "ms", good: 1800 },
];

function fmtMs(v: number): string {
  if (!v) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

function fmtNumber(v: number, unit = ""): string {
  if (!v) return "—";
  return unit ? `${unit === "ms" ? fmtMs(v) : v.toFixed(2)}` : v.toFixed(2);
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function VitalsCards({ vitals }: { vitals: VitalsMap | undefined }) {
  const present = VITAL_META.filter((m) => vitals?.[m.key]);
  if (!present.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {present.map((m) => {
        const v = vitals?.[m.key];
        const p75 = v?.p75 ?? 0;
        const good = m.key === "cls" ? p75 <= m.good : p75 <= m.good;
        return (
          <Card key={m.key}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-wide">{m.label}</span>
                <span className="font-mono">{v?.count ?? 0}</span>
              </div>
              <p
                className={`mt-1 font-mono text-lg font-semibold ${good ? "text-emerald-400" : "text-amber-400"}`}
              >
                {fmtNumber(p75, m.unit)}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">
                p50 {fmtNumber(v?.p50 ?? 0, m.unit)} · p95 {fmtNumber(v?.p95 ?? 0, m.unit)}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function PerformancePage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/performance" });
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [env, setEnv] = useState("");
  const [release, setRelease] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedName(null);
    setSelectedTxId(null);
  }, [projectId, env, release, q]);

  const { data: environments } = useQuery({
    queryKey: ["environments", projectId],
    queryFn: () => api<string[]>(`/v1/projects/${projectId}/environments`),
  });

  const { data: releases } = useQuery({
    queryKey: ["releases", projectId],
    queryFn: () => api<{ name: string }[]>(`/v1/projects/${projectId}/releases`),
  });

  const { data: summaries, isLoading } = useQuery({
    queryKey: ["tx-summaries", projectId, q, env, release],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (env) p.set("env", env);
      if (release) p.set("release", release);
      return api<TransactionSummary[]>(
        `/v1/projects/${projectId}/transaction-summaries?${p.toString()}`,
      );
    },
    refetchInterval: 15_000,
  });

  const { data: vitals } = useQuery({
    queryKey: ["web-vitals", projectId, env, release],
    queryFn: () => {
      const p = new URLSearchParams();
      if (env) p.set("env", env);
      if (release) p.set("release", release);
      return api<VitalsMap>(`/v1/projects/${projectId}/web-vitals?${p.toString()}`);
    },
  });

  const { data: releasePerf } = useQuery({
    queryKey: ["release-performance", projectId, env],
    queryFn: () => {
      const p = new URLSearchParams();
      if (env) p.set("env", env);
      return api<ReleasePerformance[]>(
        `/v1/projects/${projectId}/release-performance?${p.toString()}`,
      );
    },
  });

  const { data: series } = useQuery({
    queryKey: ["tx-series", projectId, selectedName, env, release],
    queryFn: () => {
      const p = new URLSearchParams({ name: selectedName ?? "" });
      if (env) p.set("env", env);
      if (release) p.set("release", release);
      return api<DayStat[]>(`/v1/projects/${projectId}/transaction-series?${p.toString()}`);
    },
    enabled: !!selectedName,
  });

  const { data: txList } = useQuery({
    queryKey: ["tx-list", projectId, selectedName, env, release],
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedName) p.set("q", selectedName);
      if (env) p.set("env", env);
      if (release) p.set("release", release);
      return api<Transaction[]>(`/v1/projects/${projectId}/transactions?${p.toString()}&limit=50`);
    },
    enabled: !!selectedName,
  });

  const txId = selectedTxId ?? txList?.[0]?.id;
  const { data: detail } = useQuery({
    queryKey: ["tx-detail", txId],
    queryFn: () => api<TransactionDetail>(`/v1/transactions/${txId}`),
    enabled: !!txId,
  });

  const qc = useQueryClient();
  const invalidateTx = () => {
    qc.invalidateQueries({ queryKey: ["tx-summaries"] });
    qc.invalidateQueries({ queryKey: ["tx-list"] });
    qc.invalidateQueries({ queryKey: ["tx-series"] });
    qc.invalidateQueries({ queryKey: ["release-performance"] });
  };
  const deleteRoute = useMutation({
    mutationFn: (name: string) =>
      api(`/v1/projects/${projectId}/transactions?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidateTx();
      if (selectedName) {
        setSelectedName(null);
        setSelectedTxId(null);
      }
    },
  });
  const deleteTx = useMutation({
    mutationFn: (id: string) => api(`/v1/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateTx();
      setSelectedTxId(null);
    },
  });

  const selected = summaries?.find((s) => s.name === selectedName);
  const totalCount = summaries?.reduce((a, s) => a + s.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← projetos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          {totalCount > 0 && (
            <span className="text-sm text-muted-foreground">{totalCount} transações</span>
          )}
          <div className="ml-auto">
            <Tabs
              value="performance"
              onValueChange={(v) =>
                navigate({
                  to:
                    v === "issues"
                      ? "/projects/$projectId"
                      : v === "alerts"
                        ? "/projects/$projectId/alerts"
                        : "/projects/$projectId/performance",
                  params: { projectId },
                })
              }
            >
              <TabsList>
                <TabsTrigger value="issues">Issues</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="alerts">Alertas</TabsTrigger>
                <TabsTrigger value="releases">Releases</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por rota…"
            className="w-52 pl-8"
          />
        </div>
        <Select value={env} onValueChange={(v) => setEnv(v ?? "")}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Ambiente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            {environments?.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={release} onValueChange={(v) => setRelease(v ?? "")}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Release" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todas</SelectItem>
            {releases?.map((r) => (
              <SelectItem key={r.name} value={r.name}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <VitalsCards vitals={vitals} />

      {selectedName && selected ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setSelectedName(null)}>
              <ArrowLeft /> Todas as transações
            </Button>
            <h2 className="font-mono text-lg font-semibold">{selectedName}</h2>
            <span className="text-sm text-muted-foreground">
              {selected.count} eventos · p95{" "}
              <span className="font-mono">{fmtMs(selected.p95)}</span> · taxa de erro{" "}
              <span className="font-mono">{fmtPct(selected.errorRate)}</span>
            </span>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Frequência · últimos 14 dias
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {series ? (
                <BarChart data={series.map((d) => ({ date: d.date, count: d.count }))} />
              ) : (
                <Skeleton className="h-36 w-full" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <Card className="h-fit">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Transações recentes</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[70vh] divide-y overflow-y-auto">
                  {txList?.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTxId(t.id)}
                      className={`block w-full px-3 py-2 text-left text-xs transition-colors ${
                        t.id === txId ? "bg-primary/10" : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-mono font-semibold ${
                            t.status === "ok" ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {fmtMs(t.duration)}
                        </span>
                        <span className="text-muted-foreground">{timeAgo(t.timestamp)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-muted-foreground">
                          {t.id.slice(0, 12)} · {t.release ?? "sem release"}
                          {t.browser ? ` · ${t.browser}` : ""}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Deletar esta transação?")) deleteTx.mutate(t.id);
                          }}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label="deletar transação"
                          title="deletar transação"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </button>
                  ))}
                  {!txList?.length && (
                    <p className="p-3 text-center text-muted-foreground">sem transações</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <div>
              {detail ? <Waterfall transaction={detail} /> : <Skeleton className="h-64 w-full" />}
            </div>
          </div>
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transação</TableHead>
                      <TableHead className="text-right">Eventos</TableHead>
                      <TableHead className="text-right">p50</TableHead>
                      <TableHead className="text-right">p95</TableHead>
                      <TableHead className="text-right">p99</TableHead>
                      <TableHead className="text-right">Média</TableHead>
                      <TableHead className="text-right">Erro</TableHead>
                      <TableHead className="text-right">/hora</TableHead>
                      <TableHead className="text-right">Última</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries?.map((s) => (
                      <TableRow
                        key={s.name}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedName(s.name)}
                      >
                        <TableCell className="max-w-72 truncate font-mono font-medium hover:text-primary">
                          {s.name}
                        </TableCell>
                        <TableCell className="text-right font-mono">{s.count}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMs(s.p50)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMs(s.p95)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMs(s.p99)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMs(s.avg)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {s.errorCount > 0 ? (
                            <span className="text-rose-400">{fmtPct(s.errorRate)}</span>
                          ) : (
                            <span className="text-muted-foreground">0%</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">{s.throughput}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {timeAgo(s.lastSeen)}
                        </TableCell>
                        <TableCell className="text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Deletar todas as transações de "${s.name}"?`))
                                deleteRoute.mutate(s.name);
                            }}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="deletar rota"
                            title="deletar rota"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!summaries?.length && (
                      <TableRow>
                        <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                          Nenhuma transação ainda — configure o SDK com{" "}
                          <code className="font-mono">tracesSampleRate</code>.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {releasePerf && releasePerf.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Gauge className="size-4" /> Performance por release
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Release</TableHead>
                      <TableHead className="text-right">Eventos</TableHead>
                      <TableHead className="text-right">Média</TableHead>
                      <TableHead className="text-right">p95</TableHead>
                      <TableHead className="text-right">Erro</TableHead>
                      <TableHead className="text-right">Última</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {releasePerf.map((r) => (
                      <TableRow key={r.release ?? "?"}>
                        <TableCell className="font-mono">{r.release}</TableCell>
                        <TableCell className="text-right font-mono">{r.count}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMs(r.avg)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtMs(r.p95)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {r.errorRate > 0 ? (
                            <span className="text-rose-400">{fmtPct(r.errorRate)}</span>
                          ) : (
                            <span className="text-muted-foreground">0%</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {timeAgo(r.lastSeen)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
