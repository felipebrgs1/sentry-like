import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bug,
  Globe,
  MousePointerClick,
  Pause,
  Play,
  RotateCcw,
  UserRound,
} from "lucide-react";
import type { ReplayDetail } from "@sentrylike/shared";
import { api } from "../api";
import { ReplayEngine } from "../lib/replay";
import { fmtTime } from "../lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtClock(ts: number, start: number): string {
  const s = Math.max(0, Math.round((ts - start) / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function ReplayDetailPage() {
  const { replayId } = useParams({ from: "/_app/replays/$replayId" });
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [html, setHtml] = useState("");
  const [containerW, setContainerW] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: replay, isLoading } = useQuery({
    queryKey: ["replay", replayId],
    queryFn: () => api<ReplayDetail>(`/v1/replays/${replayId}`),
  });

  const engine = useMemo(() => {
    if (!replay) return null;
    return new ReplayEngine(replay.segments.flatMap((s) => s.events));
  }, [replay]);

  const startTs = replay ? (replay.segments[0]?.events[0]?.timestamp ?? replay.timestamp) : 0;
  const total = engine?.count ?? 0;

  // aplica o estado atual ao engine e renderiza o HTML
  useEffect(() => {
    if (!engine) return;
    engine.applyTo(index);
    setHtml(engine.html());
  }, [engine, index]);

  // começa no primeiro FullSnapshot (evita tela vazia no início)
  useEffect(() => {
    if (!engine || index !== 0) return;
    const i = engine.events.findIndex((e) => e.type === 2);
    if (i >= 0) setIndex(i + 1);
  }, [engine, index]);

  // playback: avança um evento a cada 150ms
  useEffect(() => {
    if (!playing || total <= 1) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= total - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 150);
    return () => clearInterval(t);
  }, [playing, total]);

  // mede o container p/ escalar o viewport
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (isLoading || !replay || !engine) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  const { viewport } = replay;
  const scale = Math.min(1, (containerW || 800) / Math.max(1, viewport.width));

  // índice do evento de cada interação (para acender o pulso na timeline)
  const interactionIdx = useMemo(() => {
    return replay.interactions.map((it) => {
      const idx = engine.events.findIndex((e) => e.timestamp >= it.timestamp);
      return { it, idx: idx === -1 ? total - 1 : idx };
    });
  }, [replay.interactions, engine, total]);

  const activeClicks = interactionIdx.filter(({ idx }) => idx <= index && idx >= 0);
  const currentEventTs = engine.events[index]?.timestamp ?? startTs;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground">
          ← projetos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Replay</h1>
          <span className="font-mono text-xs text-muted-foreground">{replay.id.slice(0, 13)}</span>
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">
            {fmtDur(replay.durationMs)}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* player */}
        <div className="space-y-3">
          <Card>
            <CardContent className="p-3">
              <div className="overflow-hidden rounded border bg-muted/30" ref={boxRef}>
                <div
                  className="relative overflow-hidden bg-white"
                  style={{ height: "min(65vh, 600px)" }}
                >
                  <div
                    style={{
                      width: viewport.width * scale,
                      height: viewport.height * scale,
                      transform: `scale(${scale})`,
                      transformOrigin: "top left",
                    }}
                  >
                    {/* html sanitizado pela engine (tags/atributos perigosos bloqueados) */}
                    <div
                      className="pointer-events-none select-none [&_*]:pointer-events-none"
                      style={{ width: viewport.width, height: viewport.height }}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                    {activeClicks.map(({ it }, i) =>
                      it.kind === "click" && it.x != null && it.y != null ? (
                        <span
                          key={`${it.timestamp}-${i}`}
                          className="pointer-events-none absolute z-10 animate-ping rounded-full bg-rose-500/70"
                          style={{
                            left: it.x * scale,
                            top: it.y * scale,
                            width: 14,
                            height: 14,
                            transform: "translate(-50%, -50%)",
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              </div>

              {/* controles */}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (playing) setPlaying(false);
                    setIndex(Math.max(0, index - 20));
                  }}
                  disabled={index <= 0}
                >
                  <RotateCcw />
                </Button>
                <Button
                  size="icon"
                  onClick={() => setPlaying((p) => !p)}
                  disabled={total <= 1}
                  className="size-9"
                >
                  {playing ? <Pause /> : <Play />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (playing) setPlaying(false);
                    setIndex(Math.min(total - 1, index + 20));
                  }}
                  disabled={index >= total - 1}
                >
                  <ArrowRight />
                </Button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, total - 1)}
                  value={Math.min(index, Math.max(1, total - 1))}
                  onChange={(e) => {
                    setPlaying(false);
                    setIndex(Number(e.target.value));
                  }}
                  className="mx-2 flex-1 accent-violet-500"
                  aria-label="posição do replay"
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {fmtClock(currentEventTs, startTs)} / {fmtClock(replay.timestamp, startTs)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* timeline de interações */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MousePointerClick className="size-3.5" /> Interações ({replay.interactions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {replay.interactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma interação detectada (cliques/inputs/scroll).
                </p>
              ) : (
                replay.interactions.map((it, i) => {
                  const active = interactionIdx[i]?.idx != null && interactionIdx[i].idx <= index;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        setPlaying(false);
                        setIndex(Math.max(0, interactionIdx[i].idx));
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                        active
                          ? "bg-violet-500/15 text-foreground"
                          : "text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      <span className="font-mono">{fmtClock(it.timestamp, startTs)}</span>
                      <Badge
                        variant={active ? "default" : "outline"}
                        className="font-mono text-[9px]"
                      >
                        {it.kind}
                      </Badge>
                      {it.kind === "click" && it.x != null && (
                        <span className="font-mono text-muted-foreground/70">
                          x{Math.round(it.x)} y{it.y != null ? Math.round(it.y) : "?"}
                        </span>
                      )}
                      {it.kind === "input" && it.value != null && (
                        <span className="max-w-40 truncate text-muted-foreground/70">
                          {it.value.slice(0, 60)}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* metadados */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Globe className="size-3.5" /> Páginas visitadas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {replay.urls.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                replay.urls.map((u, i) => (
                  <p key={i} className="truncate font-mono text-xs text-muted-foreground">
                    {u}
                  </p>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Bug className="size-3.5" /> Erros na sessão
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {replay.errorIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum erro registrado.</p>
              ) : (
                replay.errorIds.map((e) => (
                  <p key={e} className="truncate font-mono text-xs text-muted-foreground">
                    {e}
                  </p>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <UserRound className="size-3.5" /> Usuário
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {replay.user ? (
                Object.entries(replay.user).map(([k, v]) => (
                  <p key={k} className="text-xs text-muted-foreground">
                    <span className="font-mono">{k}:</span> {String(v)}
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">anônimo</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">Detalhes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <p>
                Início: <span className="font-mono">{fmtTime(replay.timestamp)}</span>
              </p>
              <p>
                Duração: <span className="font-mono">{fmtDur(replay.durationMs)}</span>
              </p>
              <p>
                Segmentos: <span className="font-mono">{replay.segmentCount}</span>
              </p>
              <p>
                Eventos: <span className="font-mono">{replay.eventCount}</span>
              </p>
              <p>
                Release: <span className="font-mono">{replay.release ?? "—"}</span>
              </p>
              <p>
                Ambiente: <span className="font-mono">{replay.environment ?? "—"}</span>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
