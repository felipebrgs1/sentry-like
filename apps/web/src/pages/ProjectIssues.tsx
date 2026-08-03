import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  Copy,
  Eye,
  Merge,
  Package,
  RotateCw,
  Search,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import type {
  Issue,
  IssuePage,
  IssueStatus,
  Project,
  ReleaseStat,
  SavedSearch,
} from "@sentrylike/shared";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

type ProjectWithDsn = Omit<Project, "allowedDomains"> & { dsn: string; allowedDomains: string[] };

const LEVELS = ["fatal", "error", "warning", "info", "debug"];
const NEW_WINDOW_MS = 24 * 3600 * 1000;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ProjectSettings({
  project,
  onChanged,
}: {
  project: ProjectWithDsn;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(project.name);
  const [domains, setDomains] = useState((project.allowedDomains ?? []).join(", "));
  const [open, setOpen] = useState(false);

  const rename = useMutation({
    mutationFn: (newName: string) =>
      api(`/v1/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: newName }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", String(project.id)] });
      onChanged();
    },
  });

  const saveDomains = useMutation({
    mutationFn: (newDomains: string[]) =>
      api(`/v1/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ allowedDomains: newDomains }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", String(project.id)] });
    },
  });

  const rotate = useMutation({
    mutationFn: () =>
      api<{ publicKey: string }>(`/v1/projects/${project.id}/rotate-key`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", String(project.id)] });
      onChanged();
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/projects/${project.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      navigate({ to: "/projects" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="icon"
        title="Configurações do projeto"
        onClick={() => setOpen(true)}
      >
        <Settings className="size-4" />
      </Button>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Configurações</SheetTitle>
          <SheetDescription>{project.name}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 py-4">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name !== project.name) rename.mutate(name.trim());
            }}
          >
            <Label htmlFor="pname">Nome do projeto</Label>
            <div className="flex gap-2">
              <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" size="sm" disabled={rename.isPending || !name.trim()}>
                Salvar
              </Button>
            </div>
          </form>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="domains">Domínios permitidos (CORS)</Label>
            <Input
              id="domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="example.com, app.example.com"
            />
            <p className="text-xs text-muted-foreground">
              Separados por vírgula. Vazio = qualquer origem. Suporta <code>*.example.com</code>.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={saveDomains.isPending}
              onClick={() =>
                saveDomains.mutate(
                  domains
                    .split(",")
                    .map((d) => d.trim())
                    .filter(Boolean),
                )
              }
            >
              Salvar domínios
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Chave pública (DSN)</Label>
            <code className="block overflow-x-auto rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs text-muted-foreground">
              {project.publicKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              disabled={rotate.isPending}
              onClick={() => {
                if (
                  confirm(
                    "Rotacionar a chave? SDKs configurados com a chave antiga vão parar de funcionar.",
                  )
                ) {
                  rotate.mutate();
                }
              }}
            >
              <RotateCw /> Rotacionar chave
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-destructive">Zona de perigo</Label>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Deletar o projeto "${project.name}" com todas as issues e eventos?`)) {
                  remove.mutate();
                }
              }}
            >
              <Trash2 /> Deletar projeto
            </Button>
          </div>
        </div>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}

const IGNORE_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: "30 minutos", ms: 30 * 60_000 },
  { label: "1 hora", ms: 3_600_000 },
  { label: "24 horas", ms: 24 * 3_600_000 },
  { label: "Para sempre", ms: null },
];

export function ProjectIssuesPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const navigate = useNavigate();
  const [status, setStatus] = useState<IssueStatus>("unresolved");
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [env, setEnv] = useState("");
  const [release, setRelease] = useState("");
  const [copied, setCopied] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const debouncedQ = useDebounced(q, 300);
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<ProjectWithDsn>(`/v1/projects/${projectId}`),
  });

  const { data: environments } = useQuery({
    queryKey: ["environments", projectId],
    queryFn: () => api<string[]>(`/v1/projects/${projectId}/environments`),
  });

  const { data: releases } = useQuery({
    queryKey: ["releases", projectId],
    queryFn: () => api<ReleaseStat[]>(`/v1/projects/${projectId}/releases`),
  });

  const { data: savedSearches } = useQuery({
    queryKey: ["saved-searches", projectId],
    queryFn: () => api<SavedSearch[]>(`/v1/projects/${projectId}/saved-searches`),
  });

  const { data: page, isLoading } = useQuery({
    queryKey: ["issues", projectId, status, debouncedQ, level, env, release, cursor],
    queryFn: () => {
      const p = new URLSearchParams({ status });
      if (debouncedQ) p.set("q", debouncedQ);
      if (level) p.set("level", level);
      if (env) p.set("env", env);
      if (release) p.set("release", release);
      if (cursor) p.set("cursor", cursor);
      return api<IssuePage>(`/v1/projects/${projectId}/issues?${p.toString()}`);
    },
    refetchInterval: 10_000,
  });

  // acumula páginas; filtro novo ou status novo zera a lista
  useEffect(() => {
    if (!page) return;
    if (!cursor) {
      setItems(page.items);
    } else {
      setItems((prev) => {
        const map = new Map(prev.map((i) => [i.id, i] as const));
        for (const i of page.items) map.set(i.id, i);
        return [...map.values()];
      });
    }
  }, [page, cursor]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setSelected(new Set());
  }, [projectId, status, debouncedQ, level, env, release]);

  function resetList() {
    setItems([]);
    setCursor(null);
    setSelected(new Set());
  }

  const invalidateIssues = () => {
    qc.invalidateQueries({ queryKey: ["issues"] });
    qc.invalidateQueries({ queryKey: ["recent-issues"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const batch = useMutation({
    mutationFn: (body: { ids: number[]; action: string; ignoreUntil?: number | null }) =>
      api(`/v1/issues/batch`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateIssues();
      resetList();
    },
  });

  const saveSearch = useMutation({
    mutationFn: (name: string) =>
      api(`/v1/projects/${projectId}/saved-searches`, {
        method: "POST",
        body: JSON.stringify({ name, filters: { status, q, level, env, release } }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches", projectId] });
      setSaving(false);
      setSaveName("");
    },
  });

  const deleteSearch = useMutation({
    mutationFn: (id: number) => api(`/v1/saved-searches/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", projectId] }),
  });

  function applySavedSearch(f: SavedSearch["filters"]) {
    setStatus((f.status as IssueStatus) ?? "unresolved");
    setQ(f.q ?? "");
    setLevel(f.level ?? "");
    setEnv(f.env ?? "");
    setRelease(f.release ?? "");
  }

  const hasFilters = Boolean(q || level || env || release) || status !== "unresolved";
  const selectedIds = useMemo(() => [...selected], [selected]);
  const allChecked = items.length > 0 && selected.size === items.length;

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)));
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
            <>
              <Button variant="outline" size="sm" onClick={copyDsn} className="font-mono text-xs">
                {copied ? "copiado!" : <Copy />} {project.dsn}
              </Button>
              <ProjectSettings project={project} onChanged={() => {}} />
            </>
          )}
          <div className="ml-auto">
            <Tabs
              value="issues"
              onValueChange={(v) =>
                navigate({
                  to:
                    v === "performance"
                      ? "/projects/$projectId/performance"
                      : "/projects/$projectId",
                  params: { projectId },
                })
              }
            >
              <TabsList>
                <TabsTrigger value="issues">Issues</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="alerts">Alertas</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
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

        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título…"
            className="w-44 pl-8 md:w-56"
          />
        </div>

        <Select value={level} onValueChange={(v) => setLevel(v ?? "")}>
          <SelectTrigger className="w-28">
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
          <SelectTrigger className="w-28">
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
          <SelectTrigger className="w-28">
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

        {/* Search salva */}
        <div className="flex items-center gap-2">
          <Select
            value=""
            onValueChange={(v) => {
              if (v) applySavedSearch(JSON.parse(v));
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Busca salva" />
            </SelectTrigger>
            <SelectContent>
              {savedSearches?.map((s) => (
                <div key={s.id} className="flex items-center">
                  <SelectItem value={JSON.stringify(s.filters)} className="flex-1">
                    {s.name}
                  </SelectItem>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteSearch.mutate(s.id);
                    }}
                    className="p-1 text-muted-foreground hover:text-destructive"
                    title="excluir busca"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            title="Salvar filtros atuais"
            disabled={!hasFilters || saveSearch.isPending}
            onClick={() => {
              setSaving((v) => !v);
              setSaveName("");
            }}
          >
            {saving ? <Bookmark className="text-primary" /> : <BookmarkPlus className="size-4" />}
          </Button>
        </div>

        {saving && (
          <form
            className="flex w-full items-center gap-2 md:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              if (saveName.trim()) saveSearch.mutate(saveName.trim());
            }}
          >
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Nome da busca…"
              className="w-48"
            />
            <Button type="submit" size="sm" disabled={!saveName.trim() || saveSearch.isPending}>
              Salvar
            </Button>
          </form>
        )}
      </div>

      {/* Barra de ações em lote */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
          <span className="font-medium">
            {selected.size} selecionada{selected.size > 1 ? "s" : ""}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => batch.mutate({ ids: selectedIds, action: "resolve" })}
              disabled={batch.isPending}
            >
              <CheckCircle2 /> Resolver
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => batch.mutate({ ids: selectedIds, action: "unresolve" })}
              disabled={batch.isPending}
            >
              Reabrir
            </Button>
            <Select
              value=""
              onValueChange={(v) => {
                if (!v) return;
                const opt = IGNORE_OPTIONS.find((o) => o.label === v);
                if (opt)
                  batch.mutate({
                    ids: selectedIds,
                    action: "ignore",
                    ignoreUntil: opt.ms ? Date.now() + opt.ms : null,
                  });
              }}
            >
              <SelectTrigger className="h-8 w-36">
                <SelectValue placeholder="Ignorar…" />
              </SelectTrigger>
              <SelectContent>
                {IGNORE_OPTIONS.map((o) => (
                  <SelectItem key={o.label} value={o.label}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => batch.mutate({ ids: selectedIds, action: "seen" })}
              disabled={batch.isPending}
            >
              <Eye /> Marcar vistas
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={batch.isPending || selected.size < 2}
              onClick={() => {
                const target = selectedIds[0];
                const rest = selectedIds.slice(1);
                api(`/v1/issues/${target}/merge`, {
                  method: "POST",
                  body: JSON.stringify({ ids: rest }),
                }).then(() => {
                  invalidateIssues();
                  resetList();
                  return undefined;
                });
              }}
            >
              <Merge /> Mesclar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
              disabled={batch.isPending}
              onClick={() => {
                if (confirm(`Deletar ${selected.size} issue(s)?`))
                  batch.mutate({ ids: selectedIds, action: "delete" });
              }}
            >
              <Trash2 /> Deletar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={batch.isPending}
            >
              <XCircle /> Cancelar
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading && items.length === 0 ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="selecionar todas"
                      className="size-4 accent-violet-600"
                    />
                  </TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">Eventos</TableHead>
                  <TableHead className="text-right">Primeira vez</TableHead>
                  <TableHead className="text-right">Última vez</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((issue) => (
                  <TableRow key={issue.id} className={selected.has(issue.id) ? "bg-primary/5" : ""}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(issue.id)}
                        onChange={() => toggleOne(issue.id)}
                        aria-label={`selecionar ${issue.title}`}
                        className="size-4 accent-violet-600"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <LevelBadge level={issue.level} />
                        <PriorityBadge priority={issue.priority} />
                        {issue.unread === 1 && (
                          <span
                            title="não lida"
                            className="size-2 shrink-0 rounded-full bg-violet-400"
                          />
                        )}
                        <Link
                          to="/issues/$issueId"
                          params={{ issueId: String(issue.id) }}
                          className={`hover:text-primary ${issue.unread === 1 ? "font-semibold" : "font-medium"}`}
                        >
                          {issue.title}
                        </Link>
                        {issue.status === "unresolved" &&
                          Date.now() - issue.firstSeen < NEW_WINDOW_MS && (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            >
                              novo
                            </Badge>
                          )}
                        {issue.regressed === 1 && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/10 text-amber-400"
                          >
                            regressão
                          </Badge>
                        )}
                        {issue.status === "ignored" && (
                          <Badge variant="secondary" className="text-[10px]">
                            {issue.ignoredUntil && issue.ignoredUntil > Date.now()
                              ? `ignorada até ${new Date(issue.ignoredUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                              : "ignorada"}
                          </Badge>
                        )}
                        {issue.assignedTo && (
                          <Badge variant="outline" className="text-[10px]">
                            {issue.assignedTo}
                          </Badge>
                        )}
                        {issue.environment && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {issue.environment}
                          </Badge>
                        )}
                        {issue.release && (
                          <Badge
                            variant="outline"
                            className="hidden items-center gap-1 font-mono text-[10px] lg:inline-flex"
                          >
                            <Package className="size-2.5" />
                            {issue.release}
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
                {items.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
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
          {page?.nextCursor && items.length > 0 && (
            <div className="flex justify-center border-t p-3">
              <Button variant="outline" size="sm" onClick={() => setCursor(page.nextCursor)}>
                Carregar mais
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
