/**
 * Leitura de corpo e descompressão COM TETO de bytes (anti decompression bomb).
 * Tudo em Web Streams — portável entre Bun e Cloudflare Workers. O tamanho é
 * checado enquanto os chunks chegam: um gzip de 10 MB que expande para GBs é
 * abortado assim que passa do limite, sem bufferizar o resto.
 */

type Format = "gzip" | "deflate" | "deflate-raw";

export class PayloadTooLargeError extends Error {}
export class InvalidEncodingError extends Error {}

async function collect(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new PayloadTooLargeError(`payload exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Lê o corpo cru do request (já parseado pelo Elysia ou stream) com teto. */
export async function readBodyCapped(
  request: Request,
  parsed: unknown,
  max: number,
): Promise<Uint8Array> {
  if (parsed instanceof Uint8Array || typeof parsed === "string") {
    const bytes = typeof parsed === "string" ? new TextEncoder().encode(parsed) : parsed;
    if (bytes.byteLength > max) throw new PayloadTooLargeError(`payload exceeds ${max} bytes`);
    return bytes;
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) throw new PayloadTooLargeError(`payload exceeds ${max} bytes`);
  if (!request.body) return new Uint8Array();
  return collect(request.body, max);
}

/**
 * Descomprime conforme o Content-Encoding, abortando acima de `max` bytes.
 * `deflate`: tenta raw (RFC 1951) e, se falhar, zlib (RFC 1950 — o que o HTTP
 * define como `deflate`).
 */
export async function decompressCapped(
  buf: Uint8Array,
  encoding: string | null,
  max: number,
): Promise<Uint8Array> {
  const enc = encoding?.trim().toLowerCase();
  if (!enc || enc === "identity") {
    if (buf.byteLength > max) throw new PayloadTooLargeError(`payload exceeds ${max} bytes`);
    return buf;
  }
  const formats: Format[] =
    enc === "gzip" || enc === "x-gzip"
      ? ["gzip"]
      : enc === "deflate"
        ? ["deflate-raw", "deflate"]
        : [];
  if (formats.length === 0) throw new InvalidEncodingError(`unsupported content-encoding: ${enc}`);
  for (const format of formats) {
    try {
      const stream = new Blob([buf as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new DecompressionStream(format));
      return await collect(stream, max);
    } catch (e) {
      if (e instanceof PayloadTooLargeError) throw e;
    }
  }
  throw new InvalidEncodingError(`invalid ${enc} payload`);
}
