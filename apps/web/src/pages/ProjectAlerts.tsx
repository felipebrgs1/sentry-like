import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FlaskConical, Plus, Send, Trash2, X } from "lucide-react";
import type { AlertLog, AlertRule, AlertRuleType, WebhookType } from "@sentrylike/shared";
import { api } from "../api";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const TYPE_LABEL: Record<AlertRuleType, string> = {
  new_issue: "Nova issue",
  regression: "Regressão",
  frequency_spike: "Pico de frequência",
  unresolved_age: "Sem resolver X dias",
  rate_limit: "Perto do rate limit",
  daily_digest: "Resumo diário",
};

const WEBHOOK_LABEL: Record<WebhookType, string> = {
  generic: "Webhook genérico",
  slack: "Slack",
  discord: "Discord",
};

const CONFIG_FIELDS: Record<
  AlertRuleType,
  Array<{ key: string; label: string; def: number; step?: string }>
> = {
  new_issue: [],
  regression: [],
  frequency_spike: [
    { key: "window_minutes", label: "Janela (min)", def: 10 },
    { key: "threshold", label: "Mín. de vezes maior", def: 3, step: "0.1" },
    { key: "min_events", label: "Eventos mínimos", def: 10 },
  ],
  unresolved_age: [{ key: "days", label: "Dias aberta", def: 3 }],
  rate_limit: [],
  daily_digest: [],
};

export function ProjectAlertsPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/alerts" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AlertRuleType>("new_issue");
  const [webhookType, setWebhookType] = useState<WebhookType>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["alert-rules", projectId] });
    qc.invalidateQueries({ queryKey: ["alert-logs", projectId] });
  };

  const { data: rules, isLoading } = useQuery({
    queryKey: ["alert-rules", projectId],
    queryFn: () => api<AlertRule[]>(`/v1/projects/${projectId}/alert-rules`),
    refetchInterval: 15_000,
  });

  const { data: logs } = useQuery({
    queryKey: ["alert-logs", projectId],
    queryFn: () => api<AlertLog[]>(`/v1/projects/${projectId}/alert-logs?limit=30`),
    refetchInterval: 15_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api(`/v1/projects/${projectId}/alert-rules`, {
        method: "POST",
        body: JSON.stringify({
          name,
          type,
          webhookType,
          webhookUrl,
          config: Object.fromEntries(
            Object.entries(config)
              .filter(([, v]) => v !== "" && v !== undefined)
              .map(([k, v]) => [k, Number(v)]),
          ),
        }),
      }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setName("");
      setWebhookUrl("");
      setConfig({});
    },
  });

  const toggle = useMutation({
    mutationFn: (r: AlertRule) =>
      api(`/v1/alerts/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: r.enabled === 1 ? 0 : 1 }),
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/v1/alerts/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const sendTest = useMutation({
    mutationFn: (id: number) => api(`/v1/alerts/${id}/test`, { method: "POST" }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← projetos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
          <div className="ml-auto">
            <Tabs
              value="alerts"
              onValueChange={(v) =>
                navigate({
                  to:
                    v === "issues"
                      ? "/projects/$projectId"
                      : v === "performance"
                        ? "/projects/$projectId/performance"
                        : "/projects/$projectId/alerts",
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
        <p className="text-sm text-muted-foreground">
          Regras disparam para webhook (Slack/Discord/genérico). Nova issue e regressão disparam na
          hora; pico, idade, rate limit e digest rodam a cada 5 min.
        </p>
      </div>

      {!showForm && (
        <Button onClick={() => setShowForm(true)}>
          <Plus /> Nova regra
        </Button>
      )}

      {showForm && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>Nova regra</span>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}>
                <X className="size-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="aname">Nome</Label>
                <Input
                  id="aname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: erro no checkout"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType((v ?? "new_issue") as AlertRuleType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as AlertRuleType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Canal</Label>
                <Select
                  value={webhookType}
                  onValueChange={(v) => setWebhookType((v ?? "slack") as WebhookType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WEBHOOK_LABEL) as WebhookType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {WEBHOOK_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="aurl">Webhook URL</Label>
                <Input
                  id="aurl"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/…"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {CONFIG_FIELDS[type].length > 0 && (
              <div className="grid gap-4 md:grid-cols-3">
                {CONFIG_FIELDS[type].map((f) => (
                  <div key={f.key} className="space-y-2">
                    <Label htmlFor={f.key}>{f.label}</Label>
                    <Input
                      id={f.key}
                      type="number"
                      step={f.step ?? "1"}
                      defaultValue={String(f.def)}
                      onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => create.mutate()}
                disabled={!name.trim() || !webhookUrl.trim() || create.isPending}
              >
                <Send /> Salvar regra
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BellRing className="size-4" /> Regras
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Regra</TableHead>
                  <TableHead className="hidden md:table-cell">Tipo</TableHead>
                  <TableHead className="hidden lg:table-cell">Canal</TableHead>
                  <TableHead className="text-right">Último disparo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules?.map((r) => (
                  <TableRow key={r.id} className={r.enabled === 0 ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.enabled === 0 ? (
                          <Badge variant="secondary">desligada</Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/40 text-emerald-400"
                          >
                            ativa
                          </Badge>
                        )}
                      </div>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {Object.entries(r.config)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{TYPE_LABEL[r.type]}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {WEBHOOK_LABEL[r.webhookType]}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {r.lastFiredAt ? timeAgo(r.lastFiredAt) : "nunca"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Enviar teste"
                          disabled={sendTest.isPending}
                          onClick={() => sendTest.mutate(r.id)}
                        >
                          <FlaskConical className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={r.enabled === 1 ? "Desligar" : "Ligar"}
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate(r)}
                        >
                          {r.enabled === 1 ? (
                            <span className="text-amber-400">⏸</span>
                          ) : (
                            <span className="text-emerald-400">▶</span>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Excluir"
                          className="text-destructive hover:bg-destructive/10"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (confirm(`Excluir a regra "${r.name}"?`)) remove.mutate(r.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!rules?.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      Nenhuma regra — crie uma para receber alertas.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm text-muted-foreground">Atividade recente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logs?.length ? (
            <div className="divide-y">
              {logs.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Badge
                    variant={l.status === "ok" ? "secondary" : "destructive"}
                    className="shrink-0"
                  >
                    {l.status}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {new Date(l.sentAt).toLocaleString("pt-BR")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-4 text-center text-sm text-muted-foreground">Nenhum disparo ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
