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
    expect(path).toBe("1/attachments/evt-safe/__.._etc_passwd");
    expect(path).not.toContain("/../");
  });

  test("segmento eventId/subdir com traversal é recusado", async () => {
    const data = new TextEncoder().encode("x");
    for (const evil of ["../../../../tmp", "a/b", "..", "", "x".repeat(200)]) {
      expect(saveBlob(1, "attachments", evil, "index.html", data)).rejects.toThrow();
    }
    expect(saveBlob(1, "../web", "evt", "index.html", data)).rejects.toThrow();
  });

  test("read/delete não saem de DATA_DIR", async () => {
    expect(await readBlob("../../../../etc/hostname")).toBeNull();
    await deleteBlob("../../../../tmp/nao-existe"); // não lança nem apaga fora
  });
});
