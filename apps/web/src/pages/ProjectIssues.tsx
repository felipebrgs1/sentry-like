import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Search } from "lucide-react";
import type { Issue, IssueStatus, Project } from "@sentrylike/shared";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

type ProjectWithDsn = Project & { dsn: string };

const LEVELS = ["fatal", "error", "warning", "info", "debug"];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ProjectIssuesPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const [status, setStatus] = useState<IssueStatus>("unresolved");
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [env, setEnv] = useState("");
  const [copied, setCopied] = useState(false);
  const debouncedQ = useDebounced(q, 300);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<ProjectWithDsn>(`/v1/projects/${projectId}`),
  });

  const { data: environments } = useQuery({
    queryKey: ["environments", projectId],
    queryFn: () => api<string[]>(`/v1/projects/${projectId}/environments`),
  });

  const { data: issues, isLoading } = useQuery({
    queryKey: ["issues", projectId, status, debouncedQ, level, env],
    queryFn: () => {
      const p = new URLSearchParams({ status });
      if (debouncedQ) p.set("q", debouncedQ);
      if (level) p.set("level", level);
      if (env) p.set("env", env);
      return api<Issue[]>(`/v1/projects/${projectId}/issues?${p.toString()}`);
    },
    refetchInterval: 10_000,
  });

  async function copyDsn() {
    if (!project) return;
    await navigator.clipboard.writeText(project.dsn);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

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
          {project && (
            <Button variant="outline" size="sm" onClick={copyDsn} className="font-mono text-xs">
              {copied ? "copiado!" : <Copy />} {project.dsn}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
          <TabsList>
            <TabsTrigger value="unresolved">Não resolvidas</TabsTrigger>
            <TabsTrigger value="resolved">Resolvidas</TabsTrigger>
            <TabsTrigger value="ignored">Ignoradas</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative ml-auto">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título…"
            className="w-56 pl-8"
          />
        </div>

        <Select value={level} onValueChange={(v) => setLevel(v ?? "")}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Nível" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">Eventos</TableHead>
                  <TableHead className="text-right">Primeira vez</TableHead>
                  <TableHead className="text-right">Última vez</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues?.map((issue) => (
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
                        {issue.environment && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {issue.environment}
                          </Badge>
                        )}
                      </div>
                      {issue.culprit && (
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {issue.culprit}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{issue.eventCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {timeAgo(issue.firstSeen)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {timeAgo(issue.lastSeen)}
                    </TableCell>
                  </TableRow>
                ))}
                {issues?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      {status === "unresolved"
                        ? "Nenhuma issue pendente 🎉"
                        : status === "resolved"
                          ? "Nenhuma issue resolvida."
                          : "Nenhuma issue ignorada."}
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
