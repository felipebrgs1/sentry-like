import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import type { Issue, Project } from "@sentrylike/shared";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export function ProjectIssuesPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const [status, setStatus] = useState<"unresolved" | "resolved">("unresolved");
  const [copied, setCopied] = useState(false);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<ProjectWithDsn>(`/v1/projects/${projectId}`),
  });

  const { data: issues, isLoading } = useQuery({
    queryKey: ["issues", projectId, status],
    queryFn: () => api<Issue[]>(`/v1/projects/${projectId}/issues?status=${status}`),
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
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
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

      <Tabs
        value={status}
        onValueChange={(v) => setStatus(v as "unresolved" | "resolved")}
      >
        <TabsList>
          <TabsTrigger value="unresolved">Não resolvidas</TabsTrigger>
          <TabsTrigger value="resolved">Resolvidas</TabsTrigger>
        </TabsList>
      </Tabs>

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
                        : "Nenhuma issue resolvida."}
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
