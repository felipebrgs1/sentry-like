import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChartNoAxesColumn,
  CircleAlert,
  FolderKanban,
  LayoutGrid,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { Issue, OverviewStats, ProjectWithStats } from "@sentrylike/shared";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { BarChart } from "../components/BarChart";
import { timeAgo } from "../lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: number;
  icon: typeof Zap;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">
            {label}
            {hint && <span className="ml-1">· {hint}</span>}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api<OverviewStats>("/v1/stats"),
    refetchInterval: 15_000,
  });

  const { data: recentIssues } = useQuery({
    queryKey: ["recent-issues"],
    queryFn: () => api<Issue[]>("/v1/issues?limit=10"),
    refetchInterval: 15_000,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectWithStats[]>("/v1/projects"),
    refetchInterval: 30_000,
  });

  const projectName = (id: number) => projects?.find((p) => p.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
        <p className="text-sm text-muted-foreground">Saúde geral do seu erro tracking.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Issues abertas"
          value={stats?.openIssues ?? 0}
          icon={TriangleAlert}
          hint="não resolvidas"
        />
        <StatCard
          label="Eventos nas últimas 24h"
          value={stats?.events24h ?? 0}
          icon={Zap}
        />
        <StatCard label="Eventos nos últimos 7 dias" value={stats?.events7d ?? 0} icon={ChartNoAxesColumn} />
        <StatCard label="Projetos" value={projects?.length ?? 0} icon={FolderKanban} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Eventos · últimos 14 dias
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {stats ? (
            <BarChart data={stats.eventsPerDay} />
          ) : (
            <Skeleton className="h-36 w-full" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Issues recentes
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Projeto</TableHead>
                <TableHead className="text-right">Eventos</TableHead>
                <TableHead className="text-right">Última ocorrência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentIssues?.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <LevelBadge level={issue.level} />
                      <Link
                        to="/issues/$issueId"
                        params={{ issueId: String(issue.id) }}
                        className="font-medium hover:text-primary"
                      >
                        {issue.title}
                      </Link>
                    </div>
                    {issue.culprit && (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {issue.culprit}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: String(issue.projectId) }}
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <LayoutGrid className="size-3.5" />
                      {projectName(issue.projectId)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{issue.eventCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {timeAgo(issue.lastSeen)}
                  </TableCell>
                </TableRow>
              ))}
              {recentIssues?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    <CircleAlert className="mx-auto mb-2 size-6 opacity-60" />
                    Nenhuma issue pendente 🎉
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
