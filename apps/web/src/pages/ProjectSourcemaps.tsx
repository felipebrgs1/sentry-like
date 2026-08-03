import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Trash2, Upload, Wand2 } from "lucide-react";
import type { SourcemapFile, SourcemapRelease } from "@sentrylike/shared";
import { api } from "../api";
import { timeAgo } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf("base64,");
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

export function ProjectSourcemapsPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId/sourcemaps" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [release, setRelease] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; msg: string }>>([]);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<{ name: string }>(`/v1/projects/${projectId}`),
  });

  const { data: releases, isLoading: loadingReleases } = useQuery({
    queryKey: ["sourcemap-releases", projectId],
    queryFn: () => api<SourcemapRelease[]>(`/v1/projects/${projectId}/sourcemap-releases`),
    refetchInterval: 15_000,
  });

  const { data: files, isLoading: loadingFiles } = useQuery({
    queryKey: ["sourcemaps", projectId],
    queryFn: () => api<SourcemapFile[]>(`/v1/projects/${projectId}/sourcemaps`),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sourcemaps", projectId] });
    qc.invalidateQueries({ queryKey: ["sourcemap-releases", projectId] });
  };

  const delFile = useMutation({
    mutationFn: (id: number) => api(`/v1/sourcemaps/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const delRelease = useMutation({
    mutationFn: (r: string) =>
      api(`/v1/projects/${projectId}/sourcemaps?release=${encodeURIComponent(r)}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });

  async function handleUpload(selected: FileList | null) {
    if (!selected?.length) return;
    const rel = release.trim();
    if (!rel) {
      setResults([{ name: "", ok: false, msg: "informe a release antes de enviar" }]);
      return;
    }
    setBusy(true);
    setResults([]);
    const out: Array<{ name: string; ok: boolean; msg: string }> = [];
    for (const file of Array.from(selected)) {
      try {
        const content = await fileToBase64(file);
        await api(`/v1/projects/${projectId}/sourcemaps`, {
          method: "POST",
          body: JSON.stringify({ name: file.name, release: rel, content }),
        });
        out.push({ name: file.name, ok: true, msg: "enviado" });
      } catch (e) {
        out.push({ name: file.name, ok: false, msg: String(e) });
      }
    }
    setResults(out);
    setBusy(false);
    invalidate();
    if (fileRef.current) fileRef.current.value = "";
  }

  const totalFiles = files?.length ?? 0;
  const maps = files?.filter((f) => f.isSourcemap).length ?? 0;

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
              value="sourcemaps"
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
                            : v === "replays"
                              ? "/projects/$projectId/replays"
                              : "/projects/$projectId/sourcemaps",
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
            <CardTitle className="text-xs font-medium text-muted-foreground">Artefatos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{totalFiles}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Sourcemaps ({maps} de {totalFiles})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">
              {totalFiles ? `${Math.round((maps / totalFiles) * 100)}%` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Releases</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">{releases?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="size-4" /> Upload de sourcemaps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="sm-release" className="text-xs text-muted-foreground">
                Release (ex.: web@1.0.0)
              </Label>
              <Input
                id="sm-release"
                value={release}
                onChange={(e) => setRelease(e.target.value)}
                placeholder="web@1.0.0"
                className="w-56 font-mono"
              />
            </div>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <FileCode2 /> Selecionar arquivos
            </Button>
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={busy || !release.trim()}
              title="Envia os arquivos selecionados para a release informada"
            >
              <Wand2 /> Enviar para a release
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Envie o bundle minificado (<code className="font-mono">app.js</code>) e o sourcemap (
            <code className="font-mono">app.js.map</code>) da mesma release. O stacktrace passa a
            mostrar o código-fonte original (linha, função e contexto).
          </p>
          {results.length > 0 && (
            <ul className="space-y-1 text-xs">
              {results.map((r, i) => (
                <li key={i} className={r.ok ? "text-emerald-400" : "text-rose-400"}>
                  {r.name || "upload"}: {r.msg}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Como enviar pela CLI (sentry-cli)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">
            {`export SENTRY_URL=http://localhost:3001
export SENTRY_ORG=default          # slug da organização
export SENTRY_PROJECT="Demo Project"  # nome do projeto
export SENTRY_AUTH_TOKEN=<api-token>  # cria em Configurações → API tokens
export SENTRY_RELEASE=web@1.0.0

sentry-cli sourcemaps upload --release \\$SENTRY_RELEASE ./dist`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Artefatos por release</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingFiles || loadingReleases ? (
            <Skeleton className="h-32 w-full" />
          ) : !files?.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhum sourcemap enviado ainda. Faça upload acima ou use o sentry-cli.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Release</TableHead>
                  <TableHead className="w-28">Tipo</TableHead>
                  <TableHead className="w-24">Tamanho</TableHead>
                  <TableHead className="w-32">sha1</TableHead>
                  <TableHead className="w-32">Enviado</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-72 truncate font-mono text-xs">{f.name}</TableCell>
                    <TableCell className="font-mono text-xs">{f.release}</TableCell>
                    <TableCell>
                      {f.isSourcemap ? (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          map
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          bundle
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{fmtBytes(f.size)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {f.sha1.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {timeAgo(f.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={delFile.isPending}
                        onClick={() => {
                          if (confirm(`Apagar ${f.name}?`)) delFile.mutate(f.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {releases && releases.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Limpar release inteira:</span>
          {releases.map((r) => (
            <Button
              key={r.release}
              variant="outline"
              size="sm"
              className="font-mono text-xs text-destructive"
              disabled={delRelease.isPending}
              onClick={() => {
                if (confirm(`Apagar ${r.fileCount} artefatos da release ${r.release}?`)) {
                  delRelease.mutate(r.release);
                }
              }}
            >
              <Trash2 /> {r.release} ({r.fileCount})
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
