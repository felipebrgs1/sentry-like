import type { SentryStackFrame } from "@sentrylike/shared";

/**
 * Sourcemap v3 — parser mínimo (VLQ), sem dependências.
 * Portável entre Bun e Cloudflare Workers (só atob/String/TextDecoder).
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64[i]] = i;

export interface DecodedSourceMap {
  version: number;
  sources: string[];
  sourcesContent: Array<string | null> | undefined;
  names: string[];
  /** lines[line-1] = segments; segment = [genCol, srcIdx, srcLine, srcCol, nameIdx?] (0-based) */
  lines: number[][][];
}

export interface OriginalLocation {
  source: string | null;
  sourceIndex: number | null;
  line: number; // 1-based
  col: number; // 1-based
  name: string | null;
}

function decodeVlq(str: string, idx: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let cont = true;
  while (cont) {
    const digit = B64_LOOKUP[str[idx++]];
    if (digit === undefined) throw new Error("invalid sourcemap VLQ");
    cont = (digit & 32) !== 0;
    result += (digit & 31) << shift;
    shift += 5;
  }
  const negate = (result & 1) === 1;
  result >>= 1;
  return { value: negate ? -result : result, next: idx };
}

/** Decodifica o campo `mappings` em segmentos por linha (todos 0-based). */
export function decodeMappings(mappings: string): number[][][] {
  const lines = mappings.split(";");
  const result: number[][][] = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  let nameIdx = 0;
  for (const line of lines) {
    const segments: number[][] = [];
    let genCol = 0;
    if (line) {
      let i = 0;
      while (i < line.length) {
        const s0 = decodeVlq(line, i);
        i = s0.next;
        genCol += s0.value;
        const seg = [genCol];
        // segmento de 1 campo (sem source) — usado p/ "unmapped" da linha
        if (i < line.length && line[i] !== ",") {
          const s1 = decodeVlq(line, i);
          i = s1.next;
          srcIdx += s1.value;
          const s2 = decodeVlq(line, i);
          i = s2.next;
          srcLine += s2.value;
          const s3 = decodeVlq(line, i);
          i = s3.next;
          srcCol += s3.value;
          seg.push(srcIdx, srcLine, srcCol);
          if (i < line.length && line[i] !== ",") {
            const s4 = decodeVlq(line, i);
            i = s4.next;
            nameIdx += s4.value;
            seg.push(nameIdx);
          }
        }
        segments.push(seg);
        if (i < line.length && line[i] === ",") i++;
      }
    }
    result.push(segments);
  }
  return result;
}

/** Faz o parse de um sourcemap v3 (JSON já parseado). */
export function parseSourceMap(json: unknown): DecodedSourceMap | null {
  if (typeof json !== "object" || json === null) return null;
  const m = json as Record<string, unknown>;
  if (typeof m.mappings !== "string") return null;
  const sources = Array.isArray(m.sources)
    ? m.sources.filter((s): s is string => typeof s === "string")
    : [];
  const names = Array.isArray(m.names)
    ? m.names.filter((s): s is string => typeof s === "string")
    : [];
  let sourcesContent: Array<string | null> | undefined;
  if (Array.isArray(m.sourcesContent)) {
    sourcesContent = m.sourcesContent.map((c) => (typeof c === "string" ? c : null));
  }
  let lines: number[][][] = [];
  try {
    lines = decodeMappings(m.mappings);
  } catch {
    return null;
  }
  return {
    version: typeof m.version === "number" ? m.version : 3,
    sources,
    sourcesContent,
    names,
    lines,
  };
}

/**
 * Procura a posição original para (line, col) — 1-based, igual ao protocolo.
 * Usa o segmento mais à esquerda da linha com genCol <= col.
 */
export function lookupOriginal(
  map: DecodedSourceMap,
  line: number,
  col: number,
): OriginalLocation | null {
  const segments = map.lines[line - 1];
  if (!segments) return null;
  const col0 = Math.max(0, col - 1);
  let best: number[] | null = null;
  for (const seg of segments) {
    if (seg[0] > col0) break; // segments ordenados por genCol
    if (seg.length >= 4) best = seg;
  }
  if (!best) return null;
  const sourceIndex = best[1];
  return {
    source: map.sources[sourceIndex] ?? null,
    sourceIndex: sourceIndex < map.sources.length ? sourceIndex : null,
    line: best[2] + 1,
    col: best[3] + 1,
    name: best.length >= 5 ? (map.names[best[4]] ?? null) : null,
  };
}

/** Extrai `//# sourceMappingURL=...` do fim de um arquivo JS (comentário fica no fim do bundle). */
export function extractSourceMapUrl(source: string): string | null {
  const tail = source.slice(-4000);
  const m = tail.match(/[#@]\s*sourceMappingURL=([^\s*]+)/);
  if (!m?.[1]) return null;
  const url = m[1];
  // data-uri inline (sourcemap embutido no arquivo) — não resolvemos por artefato
  return url.startsWith("data:") ? null : url;
}

/** Resolve url relativo contra o nome do artefato base (ex.: dist/app.js). */
export function resolveMapUrl(baseName: string, url: string): string {
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith("//")) return url;
  if (url.startsWith("data:")) return url;
  const idx = baseName.lastIndexOf("/");
  return idx >= 0 ? `${baseName.slice(0, idx + 1)}${url}` : url;
}

/** Normaliza um nome de artefato/URL para comparação com os arquivos upados. */
export function normalizeArtifactName(name: string): string {
  let n = name.replace(/^~+/, ""); // sentry-cli prefixa com ~
  const isUrl = /^[a-z]+:\/\//i.test(n) || n.startsWith("//");
  n = n.replace(/^[a-z]+:\/\//i, "").replace(/^\/\//, "");
  if (isUrl) n = n.replace(/^[^/]+\/?/, ""); // remove host+porta
  n = n.replace(/^\/+/, "");
  return n.replace(/[?#].*$/, ""); // query/hash
}

export function artifactBasename(name: string): string {
  const idx = name.lastIndexOf("/");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

/** Busca por `{ source, line, col }` num array de frames (para testes). */
export function frameOriginalLocation(frame: SentryStackFrame): {
  filename: string;
  line: number;
  col: number;
} | null {
  const filename = frame.filename ?? frame.abs_path;
  if (!filename || frame.lineno == null) return null;
  return { filename, line: frame.lineno, col: frame.colno ?? 1 };
}
