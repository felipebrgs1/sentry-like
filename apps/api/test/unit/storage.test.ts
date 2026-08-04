import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deleteBlob, readBlob, saveBlob } from "../../src/lib/storage";

describe("BlobStore (disco)", () => {
  beforeAll(() => {
    // DATA_DIR aponta para o temp dir do preload — nada a preparar
  });

  afterAll(async () => {
    // limpa o que foi escrito neste teste
    await deleteBlob("1/attachments/evt-test/a.txt");
  });

  test("roundtrip save → read", async () => {
    const data = new TextEncoder().encode("conteúdo do anexo");
    const path = await saveBlob(1, "attachments", "evt-test", "a.txt", data);
    expect(path).toBe("1/attachments/evt-test/a.txt");

    const back = await readBlob(path);
    expect(back).not.toBeNull();
    expect(new TextDecoder().decode(back!)).toBe("conteúdo do anexo");
  });

  test("read de blob inexistente → null", async () => {
    expect(await readBlob("999/nope/x.txt")).toBeNull();
  });

  test("delete remove o blob (idempotente)", async () => {
    const path = await saveBlob(1, "attachments", "evt-del", "b.bin", new Uint8Array([1, 2, 3]));
    expect(await readBlob(path)).not.toBeNull();
    await deleteBlob(path);
    expect(await readBlob(path)).toBeNull();
    await deleteBlob(path); // não lança
  });

  test("nome do arquivo é sanitizado (sem path traversal)", async () => {
    const data = new TextEncoder().encode("x");
    const path = await saveBlob(1, "attachments", "evt-safe", "../../etc/passwd", data);
    expect(path).toBe("1/attachments/evt-safe/.._.._etc_passwd");
    expect(path).not.toContain("/../");
  });
});
