import { and, desc, eq, sql } from "drizzle-orm";
import type {
  SentryEvent,
  SentryStackFrame,
  SourcemapFile,
  SourcemapRelease,
} from "@sentrylike/shared";
import { db } from "../db";
import { sourcemapFiles } from "../db/schema";
import { deleteBlob, readBlob, saveBlob } from "../lib/storage";
import {
  artifactBasename,
  extractSourceMapUrl,
  lookupOriginal,
  normalizeArtifactName,
  parseSourceMap,
  resolveMapUrl,
  type DecodedSourceMap,
} from "../lib/sourcemap";

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

function isMapName(name: string): boolean {
  return /\.map(\.gz)?$/i.test(name);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------
// cache em memória (LRU): mapas decodificados + texto de artefatos.
// Key: `${projectId}:${release}:${name}`. Só arquivos até 4MB (volumosos demais p/ cache).
// ------------------------------------------------------------------

const MAX_CACHE = 32;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

interface CacheEntry {
  bytes: Uint8Array;
  text: string | null;
  map: DecodedSourceMap | null;
  isMap: boolean;
}

const lru = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
  const v = lru.get(key);
  if (!v) return null;
  lru.delete(key);
  lru.set(key, v);
  return v;
}

function cacheSet(key: string, v: CacheEntry) {
  lru.delete(key);
  lru.set(key, v);
  while (lru.size > MAX_CACHE) {
    const first = lru.keys().next().value as string;
    lru.delete(first);
  }
}

interface ArtifactRow {
  name: string;
  isSourcemap: number;
  storedPath: string;
}

/** Lê (com cache) o conteúdo de um artefato do projeto/release. */
async function readArtifact(
  projectId: number,
  release: string,
  row: ArtifactRow,
): Promise<CacheEntry | null> {
  const key = `${projectId}:${release}:${row.name}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const bytes = await readBlob(row.storedPath);
  if (!bytes) return null;
  if (bytes.byteLength > MAX_CACHE_BYTES) {
    // não cacheia arquivos gigantes — só decodifica sob demanda
    const isMap = row.isSourcemap === 1;
    const text = isMap ? null : new TextDecoder().decode(bytes);
    return { bytes, text, map: null, isMap };
  }
  const isMap = row.isSourcemap === 1;
  let text: string | null = null;
  let map: DecodedSourceMap | null = null;
  if (isMap) {
    const decoded = new TextDecoder().decode(bytes);
    try {
      map = parseSourceMap(JSON.parse(decoded));
    } catch {
      map = null;
    }
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const entry: CacheEntry = { bytes, text, map, isMap };
  cacheSet(key, entry);
  return entry;
}

// ------------------------------------------------------------------
// CRUD de artefatos
// ------------------------------------------------------------------

/** Converte a linha do banco (isSourcemap INTEGER) para o tipo compartilhado. */
function toFile(r: typeof sourcemapFiles.$inferSelect): SourcemapFile {
  return { ...r, isSourcemap: r.isSourcemap === 1 };
}

export async function listFiles(projectId: number, release?: string): Promise<SourcemapFile[]> {
  const cond = release
    ? and(eq(sourcemapFiles.projectId, projectId), eq(sourcemapFiles.release, release))
    : eq(sourcemapFiles.projectId, projectId);
  return (
    await db.select().from(sourcemapFiles).where(cond).orderBy(desc(sourcemapFiles.createdAt)).all()
  ).map(toFile);
}

export async function listReleases(projectId: number): Promise<SourcemapRelease[]> {
  const rows = await db
    .select({
      release: sourcemapFiles.release,
      fileCount: sql<number>`count(*)`,
      mapCount: sql<number>`sum(${sourcemapFiles.isSourcemap})`,
      totalBytes: sql<number>`sum(${sourcemapFiles.size})`,
      lastUploadAt: sql<number>`max(${sourcemapFiles.createdAt})`,
    })
    .from(sourcemapFiles)
    .where(eq(sourcemapFiles.projectId, projectId))
    .groupBy(sourcemapFiles.release)
    .orderBy(desc(sql`max(${sourcemapFiles.createdAt})`))
    .all();
  return rows.map((r) => ({
    release: r.release,
    fileCount: r.fileCount,
    mapCount: r.mapCount ?? 0,
    totalBytes: r.totalBytes ?? 0,
    lastUploadAt: r.lastUploadAt,
  }));
}

export function getFile(id: number) {
  return db.select().from(sourcemapFiles).where(eq(sourcemapFiles.id, id)).get();
}

/**
 * Upsert de um artefato. Se já existe (project, release, name) com o MESMO
 * sha1, não regrava (idempotente — sentry-cli re-uploada tudo). Se o sha1
 * mudou, substitui o conteúdo (e apaga o blob antigo).
 */
export async function saveFile(input: {
  projectId: number;
  release: string;
  name: string;
  dist?: string | null;
  contentType?: string | null;
  content: Uint8Array;
}): Promise<SourcemapFile> {
  const name = input.name.trim();
  const release = input.release.trim();
  const sha1 = await sha1Hex(input.content);
  const existing = await db
    .select()
    .from(sourcemapFiles)
    .where(
      and(
        eq(sourcemapFiles.projectId, input.projectId),
        eq(sourcemapFiles.release, release),
        eq(sourcemapFiles.name, name),
      ),
    )
    .get();
  if (existing && existing.sha1 === sha1) {
    // re-upload idêntico — devolve como está (dedup do sentry-cli)
    return toFile(existing);
  }

  const isSourcemap = isMapName(name);
  const storedPath = await saveBlob(input.projectId, "sourcemaps", release, name, input.content);

  if (existing) {
    await deleteBlob(existing.storedPath).catch(() => {});
    await db
      .update(sourcemapFiles)
      .set({
        sha1,
        size: input.content.byteLength,
        contentType: input.contentType ?? null,
        isSourcemap: isSourcemap ? 1 : 0,
        storedPath,
        createdAt: Date.now(),
      })
      .where(eq(sourcemapFiles.id, existing.id))
      .run();
    return toFile((await getFile(existing.id))!);
  }

  const row = await db
    .insert(sourcemapFiles)
    .values({
      projectId: input.projectId,
      release,
      name,
      dist: input.dist ?? null,
      sha1,
      size: input.content.byteLength,
      contentType: input.contentType ?? null,
      isSourcemap: isSourcemap ? 1 : 0,
      storedPath,
      createdAt: Date.now(),
    })
    .returning({ id: sourcemapFiles.id })
    .get();
  return toFile((await getFile(row.id))!);
}

export async function deleteFile(id: number): Promise<boolean> {
  const existing = await getFile(id);
  if (!existing) return false;
  await deleteBlob(existing.storedPath).catch(() => {});
  await db.delete(sourcemapFiles).where(eq(sourcemapFiles.id, id)).run();
  lru.delete(`${existing.projectId}:${existing.release}:${existing.name}`);
  return true;
}

export async function deleteRelease(projectId: number, release: string): Promise<number> {
  const files = await db
    .select()
    .from(sourcemapFiles)
    .where(and(eq(sourcemapFiles.projectId, projectId), eq(sourcemapFiles.release, release)))
    .all();
  for (const f of files) {
    await deleteBlob(f.storedPath).catch(() => {});
    lru.delete(`${projectId}:${release}:${f.name}`);
  }
  await db
    .delete(sourcemapFiles)
    .where(and(eq(sourcemapFiles.projectId, projectId), eq(sourcemapFiles.release, release)))
    .run();
  return files.length;
}

/** Existe algum artefato para a release? (checagem barata p/ ingestão) */
export async function hasSourcemaps(projectId: number, release: string): Promise<boolean> {
  const row = await db
    .select({ one: sql`1` })
    .from(sourcemapFiles)
    .where(and(eq(sourcemapFiles.projectId, projectId), eq(sourcemapFiles.release, release)))
    .limit(1)
    .get();
  return !!row;
}

// ------------------------------------------------------------------
// Simbolização
// ------------------------------------------------------------------

export interface SymbolizeResult {
  frames: SentryStackFrame[];
  symbolized: number;
}

function unique(names: string[]): string[] {
  return [...new Set(names)];
}

function contextLines(
  content: string,
  line: number,
): {
  pre: string[];
  current: string;
  post: string[];
} | null {
  const lines = content.split(/\r?\n/);
  if (line < 1 || line > lines.length) return null;
  const pre = lines.slice(Math.max(0, line - 4), line - 1);
  const post = lines.slice(line, Math.min(lines.length, line + 3));
  return { pre, current: lines[line - 1], post };
}

/**
 * Simboliza um frame usando os artefatos da release. Busca:
 * 1. artefato com o mesmo nome do frame → lê o comentário sourceMappingURL → map;
 * 2. artefato `<nome>.map` direto;
 * 3. tenta por basename (browser manda URL completa, upamos path relativo).
 */
export async function symbolizeFrame(
  projectId: number,
  release: string,
  artifacts: Map<string, ArtifactRow>,
  frame: SentryStackFrame,
): Promise<SentryStackFrame | null> {
  const filename = frame.filename ?? frame.abs_path;
  if (!filename || frame.lineno == null) return null;

  const norm = normalizeArtifactName(filename);
  const base = artifactBasename(norm);

  let mapRow: ArtifactRow | null = null;

  // 1) artefato-fonte: lê o comment sourceMappingURL e resolve o .map relativo
  for (const n of unique([norm, base])) {
    const sourceRow = artifacts.get(n);
    if (!sourceRow || sourceRow.isSourcemap === 1) continue;
    const entry = await readArtifact(projectId, release, sourceRow);
    if (!entry?.text) continue;
    const url = extractSourceMapUrl(entry.text);
    if (url) {
      const resolved = resolveMapUrl(n, url);
      for (const c of unique([
        normalizeArtifactName(resolved),
        artifactBasename(normalizeArtifactName(resolved)),
      ])) {
        const cand = artifacts.get(c);
        if (cand?.isSourcemap === 1) {
          mapRow = cand;
          break;
        }
      }
    }
    // fallback: `nome.js.map` ao lado do fonte
    if (!mapRow) {
      for (const c of [`${n}.map`, `${base}.map`]) {
        const cand = artifacts.get(c);
        if (cand?.isSourcemap === 1) {
          mapRow = cand;
          break;
        }
      }
    }
    if (mapRow) break;
  }

  // 2) artefato .map direto (upamos só o .map, sem o bundle)
  if (!mapRow) {
    for (const c of [`${norm}.map`, `${base}.map`]) {
      const cand = artifacts.get(c);
      if (cand?.isSourcemap === 1) {
        mapRow = cand;
        break;
      }
    }
  }
  if (!mapRow) return null;

  const entry = await readArtifact(projectId, release, mapRow);
  if (!entry) return null;
  let map = entry.map;
  if (!map) {
    const decoded = new TextDecoder().decode(entry.bytes);
    try {
      map = parseSourceMap(JSON.parse(decoded));
    } catch {
      return null;
    }
    if (map && entry.bytes.byteLength <= MAX_CACHE_BYTES) {
      entry.map = map;
      cacheSet(`${projectId}:${release}:${mapRow.name}`, entry);
    }
  }
  if (!map) return null;

  const orig = lookupOriginal(map, frame.lineno, frame.colno ?? 1);
  if (!orig) return null;

  const out: SentryStackFrame = { ...frame, symbolicated: true };
  if (orig.name) out.original_function = orig.name;
  if (orig.source) out.original_source = orig.source;
  out.original_lineno = orig.line;
  out.original_colno = orig.col;

  // contexto do código-fonte real (roadmap F8: item "contexto do código")
  if (orig.sourceIndex != null && map.sourcesContent?.[orig.sourceIndex] != null) {
    const ctx = contextLines(map.sourcesContent[orig.sourceIndex]!, orig.line);
    if (ctx) {
      out.original_pre_context = ctx.pre;
      out.original_context_line = ctx.current;
      out.original_post_context = ctx.post;
    }
  }
  return out;
}

/** Carrega a tabela de artefatos da release (nomes apenas — conteúdo é lazy). */
export async function loadArtifacts(
  projectId: number,
  release: string,
): Promise<Map<string, ArtifactRow>> {
  const rows = await db
    .select({
      name: sourcemapFiles.name,
      isSourcemap: sourcemapFiles.isSourcemap,
      storedPath: sourcemapFiles.storedPath,
    })
    .from(sourcemapFiles)
    .where(and(eq(sourcemapFiles.projectId, projectId), eq(sourcemapFiles.release, release)))
    .all();
  const map = new Map<string, ArtifactRow>();
  for (const r of rows) map.set(r.name, r);
  // nomes normalizados também apontam para o mesmo artefato (ex.: `~/dist/app.js` ≡ `dist/app.js`)
  for (const r of rows) {
    const norm = normalizeArtifactName(r.name);
    if (norm && norm !== r.name && !map.has(norm)) map.set(norm, r);
  }
  return map;
}

/** Simboliza todos os frames de um stacktrace. */
export async function symbolizeStacktrace(
  projectId: number,
  release: string,
  frames: SentryStackFrame[],
): Promise<SymbolizeResult> {
  if (!release || !frames.length) return { frames, symbolized: 0 };
  const artifacts = await loadArtifacts(projectId, release);
  if (artifacts.size === 0) return { frames, symbolized: 0 };
  const out: SentryStackFrame[] = [];
  let symbolized = 0;
  for (const f of frames) {
    const res = await symbolizeFrame(projectId, release, artifacts, f);
    if (res) {
      out.push(res);
      symbolized++;
    } else {
      out.push(f);
    }
  }
  return { frames: out, symbolized };
}

/**
 * Simboliza todas as exceptions de um evento (para o detalhe no dashboard).
 * Devolve um NOVO evento; o payload armazenado não é mutado.
 */
export async function symbolizeEvent(
  projectId: number,
  release: string | null | undefined,
  event: SentryEvent,
): Promise<SentryEvent> {
  if (!release) return event;
  const values = event.exception?.values;
  if (!values?.length) return event;
  let changed = false;
  const newValues = [];
  for (const exc of values) {
    const frames = exc.stacktrace?.frames;
    if (!frames?.length) {
      newValues.push(exc);
      continue;
    }
    const res = await symbolizeStacktrace(projectId, release, frames);
    if (res.symbolized > 0) changed = true;
    newValues.push({
      ...exc,
      stacktrace: { ...exc.stacktrace, frames: res.frames },
    });
  }
  return changed ? { ...event, exception: { ...event.exception, values: newValues } } : event;
}

/**
 * Simbolização leve para o fingerprint (Fase 2 + F8 "frames similares"):
 * se a release tem sourcemaps, os frames em destaque passam a apontar para o
 * código-fonte original — eventos de chunks minificados diferentes com a mesma
 * origem agrupam na mesma issue. Só roda quando há artefatos (checagem barata).
 */
export async function symbolizeForGrouping(
  projectId: number,
  event: SentryEvent,
): Promise<SentryEvent> {
  if (!event.release) return event;
  try {
    if (!(await hasSourcemaps(projectId, event.release))) return event;
    const symbolized = await symbolizeEvent(projectId, event.release, event);
    if (symbolized === event) return event;
    // transforma os campos original_* nos campos principais (é o que o
    // fingerprint consome) — apenas nos frames simbolizados
    const values = symbolized.exception?.values ?? [];
    const out = values.map((exc) => {
      const frames = exc.stacktrace?.frames;
      if (!frames) return exc;
      return {
        ...exc,
        stacktrace: {
          ...exc.stacktrace,
          frames: frames.map((f) => {
            if (!f.symbolicated || f.original_source == null) return f;
            return {
              ...f,
              function: f.original_function ?? f.function,
              filename: f.original_source,
              abs_path: f.original_source,
              lineno: f.original_lineno,
              colno: f.original_colno,
              context_line: f.original_context_line ?? f.context_line,
              pre_context: f.original_pre_context ?? f.pre_context,
              post_context: f.original_post_context ?? f.post_context,
            };
          }),
        },
      };
    });
    return { ...symbolized, exception: { ...symbolized.exception, values: out } };
  } catch {
    return event; // sourcemap não pode quebrar a ingestão
  }
}
