import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import type { TransactionSummary } from "@sentrylike/shared";
import { api } from "../api";
import { timeAgo } from "../lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmtMs(v: number): string {
  if (!v) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

type SummaryRow = TransactionSummary & { projectId: number; projectName: string };

export function PerformanceGlobalPage() {
  const [days, setDays] = useState(7);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["perf-global", days],
    queryFn: () => api<SummaryRow[]>(`/v1/performance/summaries?days=${days}`),
    refetchInterval: 15_000,
  });

  const totalTx = rows?.reduce((a, r) => a + r.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="text-sm text-muted-foreground">
            Rotas de todos os projetos {totalTx > 0 && `· ${totalTx} transações`}
          </p>
        </div>
        <div className="ml-auto">
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <TabsList>
              <TabsTrigger value="1">24h</TabsTrigger>
              <TabsTrigger value="7">7 dias</TabsTrigger>
              <TabsTrigger value="30">30 dias</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Projeto</TableHead>
                  <TableHead>Rota</TableHead>
                  <TableHead className="text-right">Eventos</TableHead>
                  <TableHead className="text-right">p50</TableHead>
                  <TableHead className="text-right">p95</TableHead>
                  <TableHead className="text-right">Média</TableHead>
                  <TableHead className="text-right">Erro</TableHead>
                  <TableHead className="text-right">Última</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows?.map((r) => (
                  <TableRow
                    key={`${r.projectId}:${r.name}`}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>
                      <Link
                        to="/projects/$projectId/performance"
                        params={{ projectId: String(r.projectId) }}
                        className="group inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.projectName}
                        <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/projects/$projectId/performance"
                        params={{ projectId: String(r.projectId) }}
                        className="block max-w-72 truncate font-mono font-medium hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono">{r.count}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMs(r.p50)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMs(r.p95)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtMs(r.avg)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.errorCount > 0 ? (
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
                {!rows?.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      Nenhuma transação — configure o SDK com{" "}
                      <code className="font-mono">tracesSampleRate</code>.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
