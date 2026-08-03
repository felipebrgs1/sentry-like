import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clapperboard, MonitorPlay, PlayCircle, Video } from "lucide-react";
import type { ReplaySummary } from "@sentrylike/shared";
import { api } from "../api";
import { timeAgo } from "../lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function ReplaysPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/replays" });
  const navigate = useNavigate();

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<{ name: string }>(`/v1/projects/${projectId}`),
  });

  const { data: replays, isLoading } = useQuery({
    queryKey: ["replays", projectId],
    queryFn: () => api<ReplaySummary[]>(`/v1/projects/${projectId}/replays`),
    refetchInterval: 15_000,
  });

  const total = replays?.length ?? 0;
  const withErrors = replays?.filter((r) => r.errorIds.length > 0).length ?? 0;
  const avgDuration = total ? (replays!.reduce((acc, r) => acc + r.durationMs, 0) / total) | 0 : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground">
          ← projetos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {project?.name ?? <Skeleton className="h-7 w-40" />}
          </h1>
          <div className="ml-auto">
            <Tabs
              value="replays"
              onValueChange={(v) =>
                navigate({
                  to:
                    v === "issues"
                      ? "/projects/$projectId"
                      : v === "performance"
                        ? "/projects/$projectId/performance"
                        : v === "alerts"
                          ? "/projects/$projectId/alerts"
                          : v === "releases"
                            ? "/projects/$projectId/releases"
                            : v === "sourcemaps"
                              ? "/projects/$projectId/sourcemaps"
                              : "/projects/$projectId/replays",
                  params: { projectId },
                })
              }
            >
              <TabsList>
                <TabsTrigger value="issues">Issues</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="alerts">Alertas</TabsTrigger>
                <TabsTrigger value="releases">Releases</TabsTrigger>
                <TabsTrigger value="sourcemaps">Sourcemaps</TabsTrigger>
                <TabsTrigger value="replays">Replays</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Sessões gravadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Com erro associado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{withErrors}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Duração média
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{fmtDuration(avgDuration)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clapperboard className="size-4" /> Replays
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !replays?.length ? (
            <div className="p-6 text-center">
              <Video className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhuma sessão gravada ainda. Instale o{" "}
                <code className="font-mono">@sentry/replay</code> no front para capturar replays
                (items <code className="font-mono">replay_event</code> /{" "}
                <code className="font-mono">replay_recording</code> no envelope).
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sessão</TableHead>
                  <TableHead className="w-28">Duração</TableHead>
                  <TableHead className="w-40">Página</TableHead>
                  <TableHead className="w-24">Erros</TableHead>
                  <TableHead className="w-28">Release</TableHead>
                  <TableHead className="w-32">Início</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {replays.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-56 truncate font-mono text-xs">
                      {r.id.slice(0, 13)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{fmtDuration(r.durationMs)}</TableCell>
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                      {r.urls[0] ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.errorIds.length > 0 ? (
                        <Badge variant="destructive" className="font-mono text-[10px]">
                          {r.errorIds.length}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.release ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {timeAgo(r.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          navigate({ to: "/replays/$replayId", params: { replayId: r.id } })
                        }
                      >
                        <PlayCircle />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <MonitorPlay className="size-3.5" />
        Replays expiram automaticamente em 7 dias (armazenamento local, decisão consciente do
        roadmap F9).
      </p>
    </div>
  );
}
