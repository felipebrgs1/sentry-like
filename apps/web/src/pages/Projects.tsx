import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, RefreshCw } from "lucide-react";
import type { ProjectWithStats } from "@sentrylike/shared";
import { api } from "../api";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function ProjectsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<number | null>(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectWithStats[]>("/v1/projects"),
    refetchInterval: 15_000,
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      api("/v1/projects", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  async function copyDsn(p: ProjectWithStats) {
    await navigator.clipboard.writeText(p.dsn);
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
          <p className="text-sm text-muted-foreground">
            Projetos monitorados e seus DSNs para SDKs do Sentry.
          </p>
        </div>
        <div className="flex gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate(name.trim());
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nome do projeto"
              className="w-56"
            />
            <Button type="submit" disabled={create.isPending}>
              <Plus /> Criar
            </Button>
          </form>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>DSN</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                  <TableHead className="text-right">Eventos 24h</TableHead>
                  <TableHead className="text-right">Criado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: String(p.id) }}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => copyDsn(p)}
                        className="inline-flex items-center gap-1.5 rounded border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                        title="copiar DSN"
                      >
                        {p.dsn}
                        {copied === p.id ? (
                          <span className="text-emerald-400">copiado!</span>
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{p.issueCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {p.events24h}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {timeAgo(p.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {projects?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      Nenhum projeto ainda — crie o primeiro acima.
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
