import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DATA_DIR } from "../config";

/**
 * Segmentos de caminho dos blobs. `subdir`/`eventId` vêm (indiretamente) do
 * SDK — só aceitamos [A-Za-z0-9_-] para não haver `../` (path traversal).
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

function blobKey(projectId: number, subdir: string, eventId: string, name: string): string {
  if (!Number.isInteger(projectId) || !SAFE_SEGMENT.test(subdir) || !SAFE_SEGMENT.test(eventId)) {
    throw new Error("invalid blob path segment");
  }
  const safeName = name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 200);
  return `${projectId}/${subdir}/${eventId}/${safeName || "blob"}`;
}

/** Caminho absoluto dentro de DATA_DIR (recusa qualquer coisa que escape dele). */
function insideDataDir(path: string): string {
  const root = resolve(DATA_DIR);
  const abs = resolve(root, path);
  if (!abs.startsWith(root + sep)) throw new Error("blob path escapes DATA_DIR");
  return abs;
}

/**
 * BlobStore: salva blobs (attachments/replays/sourcemaps).
 * VPS → disco (DATA_DIR). Cloudflare → R2 (env.R2).
 */
export interface BlobStore {
  save(
    projectId: number,
    subdir: string,
    eventId: string,
    name: string,
    data: Uint8Array,
  ): Promise<string>;
  read(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<void>;
}

class DiskBlobStore implements BlobStore {
  async save(
    projectId: number,
    subdir: string,
    eventId: string,
    name: string,
    data: Uint8Array,
  ): Promise<string> {
    const key = blobKey(projectId, subdir, eventId, name);
    const abs = insideDataDir(key);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, data);
    return key;
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(insideDataDir(path)));
    } catch {
      return null;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await rm(insideDataDir(path), { force: true });
    } catch {
      // já não existe
    }
  }
}

class R2BlobStore implements BlobStore {
  constructor(
    private readonly bucket: {
      put(key: string, value: Uint8Array | Blob, options?: unknown): Promise<unknown>;
      get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
      delete(key: string): Promise<unknown>;
    },
  ) {}

  async save(
    projectId: number,
    subdir: string,
    eventId: string,
    name: string,
    data: Uint8Array,
  ): Promise<string> {
    const key = blobKey(projectId, subdir, eventId, name);
    await this.bucket.put(key, data);
    return key;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(path);
    if (!obj) return null;
    return new Uint8Array(await obj.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    await this.bucket.delete(path).catch(() => {});
  }
}

let store: BlobStore = new DiskBlobStore();

/** Troca o store (worker.ts da Cloudflare chama com o binding R2). */
export function setBlobStore(s: BlobStore) {
  store = s;
}

/** Cria um BlobStore R2 a partir do binding. */
export function r2BlobStore(binding: unknown): BlobStore {
  return new R2BlobStore(
    binding as {
      put: (k: string, v: Uint8Array) => Promise<unknown>;
      get: (k: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
      delete: (k: string) => Promise<unknown>;
    },
  );
}

/** Salva um blob (attachment/replay/sourcemap) e devolve o caminho relativo. */
export async function saveBlob(
  projectId: number,
  subdir: string,
  eventId: string,
  name: string,
  data: Uint8Array,
): Promise<string> {
  return store.save(projectId, subdir, eventId, name, data);
}

/** Lê um blob salvo (null = não existe). */
export async function readBlob(path: string): Promise<Uint8Array | null> {
  return store.read(path);
}

/** Apaga um blob salvo (idempotente). */
export async function deleteBlob(path: string): Promise<void> {
  await store.delete(path);
}
