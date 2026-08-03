import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../config";

/**
 * BlobStore: salva blobs (attachments/replays).
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
}

class R2BlobStore implements BlobStore {
  constructor(
    private readonly bucket: {
      put(key: string, value: Uint8Array | Blob, options?: unknown): Promise<unknown>;
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
}

let store: BlobStore = new DiskBlobStore();

/** Troca o store (worker.ts da Cloudflare chama com o binding R2). */
export function setBlobStore(s: BlobStore) {
  store = s;
}

/** Cria um BlobStore R2 a partir do binding. */
export function r2BlobStore(binding: unknown): BlobStore {
  return new R2BlobStore(binding as { put: (k: string, v: Uint8Array) => Promise<unknown> });
}

/** Salva um blob (attachment/replay) e devolve o caminho relativo. */
export async function saveBlob(
  projectId: number,
  subdir: string,
  eventId: string,
  name: string,
  data: Uint8Array,
): Promise<string> {
  return store.save(projectId, subdir, eventId, name, data);
}
