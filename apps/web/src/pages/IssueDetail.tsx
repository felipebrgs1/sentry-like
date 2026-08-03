import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CircleCheckBig,
  CircleDot,
  Copy,
  History,
  Trash2,
} from "lucide-react";
import type {
  DayCount,
  EventDetail,
  EventSummary,
  Issue,
  IssueStatus,
  SentryBreadcrumb,
  SentryEvent,
  SentryStackFrame,
  SentryTags,
} from "@sentrylike/shared";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { BarChart } from "../components/BarChart";
import { fmtTime, timeAgo } from "../lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

function normalizeTags(tags: SentryTags | undefined): Array<[string, string]> {
  if (!tags) return [];
  return Array.isArray(tags) ? tags : Object.entries(tags);
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
  const ordered = [...frames].reverse();
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
  const tags = normalizeTags(p.tags);
  const [copied, setCopied] = useState(false);

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
        <button onClick={copyId} className="text-muted-foreground hover:text-foreground" title="copiar">
          {copied ? <span className="text-emerald-400">copiado</span> : <Copy className="size-3.5" />}
        </button>
      </div>

      {exceptions.map((exc, i) => (
        <div key={i} className="space-y-2">
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5">
            <span className="font-mono font-semibold text-destructive">
              {exc.type ?? "Error"}
            </span>
            {exc.value && <span className="ml-2 text-sm text-foreground/80">{exc.value}</span>}
          </div>
          {exc.stacktrace?.frames?.length ? <StackTrace frames={exc.stacktrace.frames} /> : null}
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
    </div>
  );
}

const STATUS_LABEL: Record<IssueStatus, string> = {
  unresolved: "aberta",
  resolved: "resolvida",
  ignored: "ignorada",
};

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
    mutationFn: (status: IssueStatus) =>
      api(`/v1/issues/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/issues/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      if (issue) navigate({ to: "/projects/$projectId", params: { projectId: String(issue.projectId) } });
    },
  });

  if (!issue) return <Skeleton className="h-64 w-full" />;

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
          <h1 className="text-xl font-semibold tracking-tight">{issue.title}</h1>
          <Badge variant={issue.status === "resolved" ? "default" : "secondary"}>
            {STATUS_LABEL[issue.status]}
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
        <div className="ml-auto flex gap-2">
          <Button
            variant={issue.status === "unresolved" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatus.mutate(issue.status === "unresolved" ? "resolved" : "unresolved")}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStatus.mutate("ignored")}
            disabled={setStatus.isPending || issue.status === "ignored"}
          >
            <Ban /> Ignorar
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
              <DetailRow label="ambiente" value={issue.environment ?? ""} />
              <DetailRow label="release" value={payload?.release ?? ""} />
              <DetailRow label="plataforma" value={payload?.platform ?? ""} />
              <DetailRow label="sdk" value={payload?.sdk?.name ? `${payload.sdk.name}@${payload.sdk.version ?? ""}` : ""} />
              <DetailRow label="fingerprint" value={issue.fingerprint.slice(0, 16) + "…"} />
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
