import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleDot, History } from "lucide-react";
import type {
  EventDetail,
  EventSummary,
  Issue,
  SentryBreadcrumb,
  SentryEvent,
  SentryStackFrame,
  SentryTags,
} from "@sentrylike/shared";
import { api } from "../api";
import { LevelBadge } from "../components/LevelBadge";
import { fmtTime } from "../lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <pre className="max-h-64 overflow-auto bg-muted/40 p-4 text-xs text-muted-foreground">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CardContent>
    </Card>
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

function EventView({ event }: { event: EventDetail }) {
  const p = event.payload;
  const exceptions = p.exception?.values ?? [];
  const breadcrumbs = normalizeBreadcrumbs(p.breadcrumbs);
  const tags = normalizeTags(p.tags);

  return (
    <div className="space-y-4">
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

      {breadcrumbs.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Breadcrumbs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y text-xs">
              {breadcrumbs.map((b, i) => (
                <div key={i} className="flex gap-3 px-4 py-2">
                  <span className="w-20 shrink-0 font-mono text-muted-foreground">
                    {b.timestamp ? new Date(b.timestamp * 1000).toLocaleTimeString() : "—"}
                  </span>
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {b.category ?? b.type ?? ""}
                  </span>
                  <span className="text-foreground/80">
                    {b.message ?? JSON.stringify(b.data ?? {})}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <JsonBlock title="Request" data={p.request} />
      <JsonBlock title="User" data={p.user} />
      <JsonBlock title="Contexts" data={p.contexts} />
      <JsonBlock title="Extra" data={p.extra} />
    </div>
  );
}

export function IssueDetailPage() {
  const { issueId } = useParams({ from: "/_app/issues/$issueId" });
  const id = Number(issueId);
  const qc = useQueryClient();
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

  const { data: issue } = useQuery({
    queryKey: ["issue", id],
    queryFn: () => api<Issue>(`/v1/issues/${id}`),
  });

  const { data: events } = useQuery({
    queryKey: ["issue-events", id],
    queryFn: () => api<EventSummary[]>(`/v1/issues/${id}/events`),
  });

  const eventId = selectedEvent ?? events?.[0]?.id;
  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => api<EventDetail>(`/v1/events/${eventId}`),
    enabled: !!eventId,
  });

  const setStatus = useMutation({
    mutationFn: (status: "resolved" | "unresolved") =>
      api(`/v1/issues/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue", id] });
      qc.invalidateQueries({ queryKey: ["issues"] });
    },
  });

  if (!issue) return <Skeleton className="h-64 w-full" />;

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
            {issue.status === "resolved" ? "resolvida" : "aberta"}
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
        <span className="text-muted-foreground">
          primeira: <span className="text-foreground">{fmtTime(issue.firstSeen)}</span>
        </span>
        <span className="text-muted-foreground">
          última: <span className="text-foreground">{fmtTime(issue.lastSeen)}</span>
        </span>
        <Button
          variant={issue.status === "resolved" ? "outline" : "default"}
          size="sm"
          className="ml-auto"
          onClick={() =>
            setStatus.mutate(issue.status === "resolved" ? "unresolved" : "resolved")
          }
          disabled={setStatus.isPending}
        >
          {issue.status === "resolved" ? (
            <>
              <CircleDot /> Reabrir
            </>
          ) : (
            <>
              <CircleCheck /> Resolver
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="size-4" /> Ocorrências
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[65vh]">
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
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-muted-foreground">
                      {fmtTime(e.timestamp)}
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
      </div>
    </div>
  );
}
