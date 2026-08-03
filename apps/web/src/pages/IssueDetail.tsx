import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bot,
  ChevronDown,
  CircleCheckBig,
  CircleDot,
  Copy,
  Eye,
  GitMerge,
  History,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  DayCount,
  EnvCount,
  EventDetail,
  EventSummary,
  Issue,
  IssueStatus,
  SentryBreadcrumb,
  SentryEvent,
  SentryStackFrame,
  SentryTags,
  UserReport,
} from "@sentrylike/shared";
import { api } from "../api";
import { buildAgentPrompt } from "../lib/agentPrompt";
import { LevelBadge } from "../components/LevelBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { BarChart } from "../components/BarChart";
import { fmtTime, timeAgo } from "../lib/format";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function normalizeTags(tags: SentryTags | undefined): Array<[string, string]> {
  if (!tags) return [];
  return Array.isArray(tags) ? tags : Object.entries(tags);
}

/** Feedback dos usuários sobre os eventos desta issue (Fase 6). */
function IssueFeedback({ issueId }: { issueId: number }) {
  const { data } = useQuery({
    queryKey: ["issue-reports", issueId],
    queryFn: () => api<UserReport[]>(`/v1/issues/${issueId}/user-reports`),
  });
  if (!data?.length) return null;
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Feedback dos usuários</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((r) => (
          <div key={r.eventId} className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.name ?? "anônimo"}</span>
              {r.email && (
                <span className="font-mono text-xs text-muted-foreground">{r.email}</span>
              )}
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {new Date(r.timestamp).toLocaleString("pt-BR")}
              </span>
            </div>
            {r.comments && <p className="mt-1.5 text-foreground/85">{r.comments}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Distribuição dos eventos da issue por ambiente ou release (Fase 3). */
function IssueDistribution({ title, url }: { title: string; url: string }) {
  const { data } = useQuery({
    queryKey: [url],
    queryFn: () => api<EnvCount[]>(url),
  });
  const max = Math.max(1, ...(data ?? []).map((d) => d.count));
  if (!data?.length) return null;
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate font-mono text-muted-foreground">{d.name}</span>
            <div className="h-3.5 flex-1 overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary/70"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="w-12 shrink-0 text-right font-mono">{d.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function normalizeBreadcrumbs(bc: SentryEvent["breadcrumbs"]): SentryBreadcrumb[] {
  if (!bc) return [];
  return Array.isArray(bc) ? bc : (bc.values ?? []);
}

function JsonBlock({ title, data }: { title: string; data: unknown }) {
  if (data == null) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <pre className="max-h-48 overflow-auto rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all text-right font-mono text-foreground">{value}</span>
    </div>
  );
}

function StackTrace({ frames }: { frames: SentryStackFrame[] }) {
  // Sentry frames arrive oldest-first; display most recent call first
  const ordered = [...frames].toReversed();
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Stack trace</CardTitle>
      </CardHeader>
      <CardContent className="divide-y p-0 text-sm">
        {ordered.map((f, i) => (
          <div key={i} className={`px-4 py-2.5 ${f.in_app ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono font-medium text-foreground">
                {f.function ?? "anonymous"}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {f.filename ?? f.abs_path ?? "?"}
                {f.lineno != null && `:${f.lineno}`}
                {f.colno != null && `:${f.colno}`}
              </span>
              {!f.in_app && <Badge variant="secondary">lib</Badge>}
            </div>
            {f.context_line && (
              <pre className="mt-1.5 overflow-x-auto rounded border bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
                {f.pre_context?.map((l) => `  ${l}\n`).join("")}
                {f.context_line}
                {f.post_context?.map((l) => `\n  ${l}`).join("")}
              </pre>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BreadcrumbTimeline({ breadcrumbs }: { breadcrumbs: SentryBreadcrumb[] }) {
  return (
    <ol className="space-y-3 border-l border-border pl-4">
      {breadcrumbs.map((b, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[21.5px] top-1.5 size-2 rounded-full border border-border bg-background" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">
              {b.timestamp ? new Date(b.timestamp * 1000).toLocaleTimeString("pt-BR") : "—"}
            </span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {b.category ?? b.type ?? "log"}
            </Badge>
            {b.level && <span className="text-muted-foreground">{b.level}</span>}
          </div>
          <p className="mt-0.5 text-sm text-foreground/85">
            {b.message ?? JSON.stringify(b.data ?? {})}
          </p>
        </li>
      ))}
    </ol>
  );
}

function EventView({ event }: { event: EventDetail }) {
  const p = event.payload;
  const exceptions = p.exception?.values ?? [];
  const breadcrumbs = normalizeBreadcrumbs(p.breadcrumbs);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("resumo");

  async function copyId() {
    await navigator.clipboard.writeText(event.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">event id</span>
        <code className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono">{event.id}</code>
        <button
          onClick={copyId}
          className="text-muted-foreground hover:text-foreground"
          title="copiar"
        >
          {copied ? (
            <span className="text-emerald-400">copiado</span>
          ) : (
            <Copy className="size-3.5" />
          )}
        </button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <TabsContent value="resumo" className="mt-4 space-y-4">
          {exceptions.map((exc, i) => (
            <div key={i} className="space-y-2">
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5">
                <span className="font-mono font-semibold text-destructive">
                  {exc.type ?? "Error"}
                </span>
                {exc.value && <span className="ml-2 text-sm text-foreground/80">{exc.value}</span>}
              </div>
              {exc.stacktrace?.frames?.length ? (
                <StackTrace frames={exc.stacktrace.frames} />
              ) : null}
            </div>
          ))}

          {breadcrumbs.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Breadcrumbs</CardTitle>
              </CardHeader>
              <CardContent>
                <BreadcrumbTimeline breadcrumbs={breadcrumbs} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="json" className="mt-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Payload bruto do evento</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[70vh]">
                <pre className="p-4 font-mono text-xs leading-relaxed text-muted-foreground">
                  {JSON.stringify(p, null, 2)}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const STATUS_LABEL: Record<IssueStatus, string> = {
  unresolved: "aberta",
  resolved: "resolvida",
  ignored: "ignorada",
  merged: "mesclada",
};

const IGNORE_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: "30 minutos", ms: 30 * 60_000 },
  { label: "1 hora", ms: 3_600_000 },
  { label: "24 horas", ms: 24 * 3_600_000 },
  { label: "Para sempre", ms: null },
];

export function IssueDetailPage() {
  const { issueId } = useParams({ from: "/_app/issues/$issueId" });
  const id = Number(issueId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  const { data: issue } = useQuery({
    queryKey: ["issue", id],
    queryFn: () => api<Issue>(`/v1/issues/${id}`),
  });

  const { data: events } = useQuery({
    queryKey: ["issue-events", id],
    queryFn: () => api<EventSummary[]>(`/v1/issues/${id}/events`),
  });

  const { data: eventStats } = useQuery({
    queryKey: ["issue-stats", id],
    queryFn: () => api<DayCount[]>(`/v1/issues/${id}/stats`),
  });

  const eventId = selectedEvent ?? events?.[0]?.id;
  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => api<EventDetail>(`/v1/events/${eventId}`),
    enabled: !!eventId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["issue", id] });
    qc.invalidateQueries({ queryKey: ["issues"] });
    qc.invalidateQueries({ queryKey: ["recent-issues"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const setStatus = useMutation({
    mutationFn: (args: { status: IssueStatus; ignoreUntil?: number | null }) =>
      api(`/v1/issues/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: args.status, ignoreUntil: args.ignoreUntil ?? null }),
      }),
    onSuccess: invalidate,
  });

  const markSeen = useMutation({
    mutationFn: () => api(`/v1/issues/${id}/seen`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const assign = useMutation({
    mutationFn: (assignedTo: string | null) =>
      api(`/v1/issues/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ assignedTo }),
      }),
    onSuccess: invalidate,
  });

  const unmerge = useMutation({
    mutationFn: () => api(`/v1/issues/${id}/unmerge`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/issues/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      if (issue)
        navigate({ to: "/projects/$projectId", params: { projectId: String(issue.projectId) } });
    },
  });

  const [copiedAgent, setCopiedAgent] = useState(false);
  const { data: project } = useQuery({
    queryKey: ["project", String(issue?.projectId ?? "")],
    queryFn: () => api<{ name: string }>(`/v1/projects/${issue?.projectId}`),
    enabled: !!issue,
  });

  async function copyForAgent() {
    if (!issue || !event) return;
    const text = buildAgentPrompt({
      issue,
      projectName: project?.name,
      event,
      events: undefined,
    });
    await navigator.clipboard.writeText(text);
    setCopiedAgent(true);
    setTimeout(() => setCopiedAgent(false), 1500);
  }

  // marca como lida ao abrir o detalhe (atividade nova só aparece na listagem)
  useEffect(() => {
    if (issue?.unread === 1) markSeen.mutate();
  }, [issue?.unread, id, markSeen]);

  if (!issue) return <Skeleton className="h-64 w-full" />;

  const ignoreEnd =
    issue.ignoredUntil && issue.ignoredUntil > Date.now() ? issue.ignoredUntil : null;

  const payload = event?.payload;
  const tags = normalizeTags(payload?.tags);
  const totalEvents = eventStats?.reduce((a, b) => a + b.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/projects/$projectId"
          params={{ projectId: String(issue.projectId) }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← issues
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <LevelBadge level={issue.level} />
          <PriorityBadge priority={issue.priority} />
          <h1 className="text-xl font-semibold tracking-tight">{issue.title}</h1>
          {issue.regressed === 1 && (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400">
              regressão
            </Badge>
          )}
          <Badge variant={issue.status === "resolved" ? "default" : "secondary"}>
            {STATUS_LABEL[issue.status]}
            {ignoreEnd
              ? ` até ${new Date(ignoreEnd).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </Badge>
        </div>
        {issue.culprit && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">{issue.culprit}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          eventos: <span className="font-mono text-foreground">{issue.eventCount}</span>
        </span>
        {issue.environment && (
          <span className="text-muted-foreground">
            ambiente:{" "}
            <Badge variant="outline" className="font-mono">
              {issue.environment}
            </Badge>
          </span>
        )}
        <span className="text-muted-foreground">
          primeira: <span className="text-foreground">{timeAgo(issue.firstSeen)}</span>
        </span>
        <span className="text-muted-foreground">
          última: <span className="text-foreground">{timeAgo(issue.lastSeen)}</span>
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            title="Copia um resumo em markdown pronto para colar num agente de IA"
            disabled={!event || copiedAgent}
            onClick={copyForAgent}
          >
            {copiedAgent ? "copiado!" : <Bot />}
            {!copiedAgent && <span className="hidden sm:inline">Copiar para agente</span>}
          </Button>
          <Button
            variant={issue.status === "unresolved" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setStatus.mutate({
                status: issue.status === "unresolved" ? "resolved" : "unresolved",
              })
            }
            disabled={setStatus.isPending}
          >
            {issue.status === "unresolved" ? (
              <>
                <CircleCheckBig /> Resolver
              </>
            ) : (
              <>
                <CircleDot /> Reabrir
              </>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={buttonVariants({ variant: "outline", size: "sm" })}
              disabled={setStatus.isPending}
            >
              <Ban />{" "}
              {ignoreEnd
                ? `Ignorada até ${new Date(ignoreEnd).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                : "Ignorar"}
              <ChevronDown className="size-3.5 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Ignorar por</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {IGNORE_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.label}
                  onSelect={() =>
                    setStatus.mutate({
                      status: "ignored",
                      ignoreUntil: opt.ms ? Date.now() + opt.ms : null,
                    })
                  }
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markSeen.mutate()}
            disabled={markSeen.isPending || issue.unread === 0}
          >
            <Eye /> {issue.unread === 1 ? "Marcar como vista" : "Vista"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Restaurar issues que foram mescladas nesta?")) unmerge.mutate();
            }}
            disabled={unmerge.isPending}
            title="Restaurar issues mescladas"
          >
            <GitMerge /> Desmesclar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm("Deletar esta issue e todos os seus eventos?")) remove.mutate();
            }}
          >
            <Trash2 /> Deletar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Frequência · últimos 14 dias{" "}
            {totalEvents > 0 && <span className="font-mono">({totalEvents} eventos)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {eventStats ? <BarChart data={eventStats} /> : <Skeleton className="h-36 w-full" />}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <IssueDistribution title="Por ambiente" url={`/v1/issues/${id}/environments`} />
        <IssueDistribution title="Por release" url={`/v1/issues/${id}/releases`} />
      </div>

      <IssueFeedback issueId={id} />

      <div className="grid gap-6 xl:grid-cols-[280px_1fr_280px]">
        <Card className="h-fit">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="size-4" /> Ocorrências
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[60vh]">
              <div className="space-y-1 p-3">
                {events?.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEvent(e.id)}
                    className={`block w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      e.id === eventId
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <LevelBadge level={e.level} />
                      <span className="font-mono text-muted-foreground">
                        {new Date(e.timestamp).toLocaleTimeString("pt-BR")}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-muted-foreground">
                      {fmtTime(e.timestamp)}
                      {e.environment && <span>{e.environment}</span>}
                    </div>
                  </button>
                ))}
                {!events?.length && (
                  <p className="p-3 text-center text-muted-foreground">sem ocorrências</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div>
          {eventLoading && !event ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : event ? (
            <EventView event={event} />
          ) : (
            <p className="text-muted-foreground">…</p>
          )}
        </div>

        {/* Painel de detalhes, estilo Sentry */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Detalhes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 py-2">
              <DetailRow label="nível" value={issue.level} />
              <DetailRow label="prioridade" value={issue.priority} />
              <DetailRow label="ambiente" value={issue.environment ?? ""} />
              <DetailRow label="release" value={payload?.release ?? ""} />
              <DetailRow label="plataforma" value={payload?.platform ?? ""} />
              <DetailRow
                label="sdk"
                value={payload?.sdk?.name ? `${payload.sdk.name}@${payload.sdk.version ?? ""}` : ""}
              />
              <DetailRow label="fingerprint" value={issue.fingerprint.slice(0, 16) + "…"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <UserRound className="size-4" /> Atribuída a
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 py-2">
              {issue.assignedTo ? (
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono">
                    {issue.assignedTo}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={assign.isPending}
                    onClick={() => assign.mutate(null)}
                  >
                    Desatribuir
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Não atribuída.</p>
              )}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = (e.currentTarget.elements.namedItem("assignee") as HTMLInputElement)
                    ?.value;
                  if (v?.trim()) assign.mutate(v.trim());
                }}
              >
                <input
                  name="assignee"
                  placeholder="nome ou email…"
                  className="h-8 w-full rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-primary"
                />
                <Button type="submit" variant="outline" size="sm" disabled={assign.isPending}>
                  Atribuir
                </Button>
              </form>
            </CardContent>
          </Card>

          {tags.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Tags</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {tags.map(([k, v]) => (
                  <Badge key={k} variant="outline" className="font-mono">
                    {k}=<span className="text-primary">{v}</span>
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          <JsonBlock title="User" data={payload?.user} />
          <JsonBlock title="Request" data={payload?.request} />
          <JsonBlock title="Contexts" data={payload?.contexts} />
          <JsonBlock title="Extra" data={payload?.extra} />
        </div>
      </div>
    </div>
  );
}
