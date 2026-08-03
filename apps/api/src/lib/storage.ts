import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../config";

/** Salva um blob (attachment/replay) em disco e devolve o caminho relativo ao DATA_DIR. */
export async function saveBlob(
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
