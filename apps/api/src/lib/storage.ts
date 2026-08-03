import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../config";

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
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
    const dir = join(DATA_DIR, String(projectId), subdir, eventId);
    await mkdir(dir, { recursive: true });
    const abs = join(dir, safeName);
    await writeFile(abs, data);
    return join(String(projectId), subdir, eventId, safeName);
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      const abs = join(DATA_DIR, path);
      return new Uint8Array(await readFile(abs));
    } catch {
      return null;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await rm(join(DATA_DIR, path), { force: true });
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
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
    const key = `${projectId}/${subdir}/${eventId}/${safeName}`;
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
