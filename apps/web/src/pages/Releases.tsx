import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, GitCommitHorizontal, Package } from "lucide-react";
import type { DayCrashFree, Release, ReleaseCompare, ReleaseDetail } from "@sentrylike/shared";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";

function fmtMs(v: number): string {
  if (!v) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Série temporal de crash-free (CSS puro). */
function CrashFreeChart({ projectId, release }: { projectId: number; release: string }) {
  const { data } = useQuery({
    queryKey: ["crash-free-series", projectId, release],
    queryFn: () =>
      api<DayCrashFree[]>(
        `/v1/projects/${projectId}/crash-free-series?release=${encodeURIComponent(release)}&days=14`,
      ),
  });
  const days = data ?? [];
  const hasData = days.some((d) => d.total > 0);
  if (!hasData) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          Crash-free · últimos 14 dias
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex h-32 items-end gap-[3px]">
          {days.map((d) => (
            <div
              key={d.date}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${d.date}: ${(d.crashFree * 100).toFixed(1)}% (${d.total} sessões)`}
            >
              <div
                className={`min-h-[2px] w-full rounded-sm transition-colors ${
                  d.crashFree >= 0.99
                    ? "bg-emerald-500/60"
                    : d.crashFree >= 0.95
                      ? "bg-amber-500/60"
                      : "bg-rose-500/60"
                } group-hover:brightness-125`}
                style={{ height: `${Math.max(d.crashFree * 100, 2)}%` }}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Bars({ data }: { data: Array<{ name: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate font-mono text-muted-foreground">{d.name}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-primary/70"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono">
            {d.count}{" "}
            <span className="text-muted-foreground">({Math.round((d.count / total) * 100)}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CompareView({ data, onBack }: { data: ReleaseCompare; onBack: () => void }) {
  const rows: Array<[string, string, string]> = [
    ["Eventos", String(data.a.events), String(data.b.events)],
    ["Issues novas", String(data.a.newIssues), String(data.b.newIssues)],
    ["Issues (total)", String(data.a.issuesTotal), String(data.b.issuesTotal)],
    ["Transações", String(data.a.txCount), String(data.b.txCount)],
    ["Latência média", fmtMs(data.a.txAvg), fmtMs(data.b.txAvg)],
    ["Crash-free", fmtPct(data.a.crashFree ?? 0), fmtPct(data.b.crashFree ?? 0)],
    ["Sessões", String(data.a.sessions), String(data.b.sessions)],
    ["p95", fmtMs(data.a.txP95), fmtMs(data.b.txP95)],
    ["Taxa de erro", fmtPct(data.a.txErrorRate), fmtPct(data.b.txErrorRate)],
    ["Primeira ocorrência", timeAgo(data.a.firstSeen), timeAgo(data.b.firstSeen)],
    ["Última ocorrência", timeAgo(data.a.lastSeen), timeAgo(data.b.lastSeen)],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft /> Voltar
        </Button>
        <h2 className="text-lg font-semibold">Comparação de releases</h2>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Métrica</TableHead>
                <TableHead className="text-right">
                  <span className="font-mono">{data.a.name}</span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="font-mono">{data.b.name}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(([label, va, vb]) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="text-right font-mono">{va}</TableCell>
                  <TableCell className="text-right font-mono">{vb}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function ReleasesPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/releases" });
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<string>("");

  const { data: releases, isLoading } = useQuery({
    queryKey: ["releases-page", projectId],
    queryFn: () => api<Release[]>(`/v1/projects/${projectId}/releases`),
    refetchInterval: 15_000,
  });

  const { data: detail } = useQuery({
    queryKey: ["release-detail", projectId, selected],
    queryFn: () =>
      api<ReleaseDetail>(
        `/v1/projects/${projectId}/release-detail?name=${encodeURIComponent(selected ?? "")}`,
      ),
    enabled: !!selected,
  });

  const { data: compare } = useQuery({
    queryKey: ["release-compare", projectId, selected, compareTo],
    queryFn: () =>
      api<ReleaseCompare>(
        `/v1/projects/${projectId}/releases-compare?a=${encodeURIComponent(selected ?? "")}&b=${encodeURIComponent(compareTo)}`,
      ),
    enabled: !!selected && !!compareTo && compareTo !== selected,
  });

  if (compare && selected && compareTo && compareTo !== selected) {
    return (
      <div className="space-y-6">
        <CompareView
          data={compare}
          onBack={() => {
            setCompareTo("");
            setSelected(null);
          }}
        />
      </div>
    );
  }

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
          <h1 className="text-2xl font-semibold tracking-tight">Releases</h1>
          <div className="ml-auto">
            <Tabs
              value="releases"
              onValueChange={(v) =>
                navigate({
                  to:
                    v === "issues"
                      ? "/projects/$projectId"
                      : v === "performance"
                        ? "/projects/$projectId/performance"
                        : v === "alerts"
                          ? "/projects/$projectId/alerts"
                          : "/projects/$projectId/releases",
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
        <p className="text-sm text-muted-foreground">
          Releases auto-descobertas de eventos e transações; marcadas via webhook de deploy
          (GitHub/GitLab) ou manualmente.
        </p>
      </div>

      {selected && detail ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
              <ArrowLeft /> Todas as releases
            </Button>
            <h2 className="flex items-center gap-2 font-mono text-lg font-semibold">
              <Package className="size-4 text-muted-foreground" /> {detail.name}
            </h2>
            {detail.deployedAt && (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
                deploy {timeAgo(detail.deployedAt)}
              </Badge>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Comparar com:</span>
              <Select value={compareTo} onValueChange={(v) => setCompareTo(v ?? "")}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="selecionar release" />
                </SelectTrigger>
                <SelectContent>
                  {releases
                    ?.filter((r) => r.name !== selected)
                    .map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {[
              ["Eventos", String(detail.events)],
              ["Transações", String(detail.transactions)],
              ["Issues novas", String(detail.newIssues.length)],
              ["Latência média", fmtMs(detail.txAvg)],
              ["p95", fmtMs(detail.txP95)],
              [
                "Crash-free",
                detail.crashFree != null
                  ? `${(detail.crashFree * 100).toFixed(1)}% (${detail.sessions} sessões)`
                  : "—",
              ],
            ].map(([label, v]) => (
              <Card key={label}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 font-mono text-lg font-semibold">{v}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <CrashFreeChart projectId={Number(projectId)} release={detail.name} />

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Issues novas na release</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-80 divide-y overflow-y-auto">
                  {detail.newIssues.map((i) => (
                    <Link
                      key={i.id}
                      to="/issues/$issueId"
                      params={{ issueId: String(i.id) }}
                      className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted/50"
                    >
                      <LevelBadge level={i.level} />
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {i.eventCount} ev
                      </span>
                    </Link>
                  ))}
                  {!detail.newIssues.length && (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      Nenhuma issue nova — release limpa ✨
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Ambientes</CardTitle>
              </CardHeader>
              <CardContent>
                {detail.environments.length ? (
                  <Bars
                    data={detail.environments.map((e) => ({
                      name: e.environment,
                      count: e.events,
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">sem dados de ambiente</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <GitCommitHorizontal className="size-4" /> Commits do deploy
                {detail.commits.length > 0 && (
                  <span className="font-mono text-xs text-muted-foreground">
                    ({detail.commits.length})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {detail.commits.length ? (
                <div className="divide-y">
                  {detail.commits.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {c.id.slice(0, 7)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.message}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.author}</span>
                      {c.timestamp && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(c.timestamp).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Sem commits — configure o webhook de deploy:{" "}
                  <code className="font-mono">POST /v1/webhooks/releases/:projectId</code>
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Release</TableHead>
                    <TableHead className="text-right">Eventos</TableHead>
                    <TableHead className="text-right">Transações</TableHead>
                    <TableHead className="text-right">Issues</TableHead>
                    <TableHead className="text-right">Deploy</TableHead>
                    <TableHead className="text-right">Última ocorrência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releases?.map((r) => (
                    <TableRow
                      key={r.name}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelected(r.name)}
                    >
                      <TableCell className="font-mono font-medium hover:text-primary">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.events}</TableCell>
                      <TableCell className="text-right font-mono">{r.transactions}</TableCell>
                      <TableCell className="text-right font-mono">{r.issues}</TableCell>
                      <TableCell className="text-right">
                        {r.deployedAt ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/40 text-emerald-400"
                          >
                            {timeAgo(r.deployedAt)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {timeAgo(r.lastSeen)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!releases?.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        Nenhuma release ainda — envie eventos com o campo{" "}
                        <code className="font-mono">release</code>.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
