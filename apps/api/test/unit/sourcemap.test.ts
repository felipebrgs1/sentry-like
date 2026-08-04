import { describe, expect, test } from "bun:test";
import {
  artifactBasename,
  decodeMappings,
  extractSourceMapUrl,
  lookupOriginal,
  normalizeArtifactName,
  parseSourceMap,
  resolveMapUrl,
} from "../../src/lib/sourcemap";

describe("decodeMappings (VLQ)", () => {
  test("AAAA → segmento (genCol 0, src 0, linha 0, col 0)", () => {
    expect(decodeMappings("AAAA")).toEqual([[[0, 0, 0, 0]]]);
  });

  test("multi-linha: ';' separa linhas", () => {
    // linha 2: srcLine relativa +1
    expect(decodeMappings("AAAA;AACA")).toEqual([[[0, 0, 0, 0]], [[0, 0, 1, 0]]]);
  });

  test("múltiplos segmentos na mesma linha separados por vírgula", () => {
    expect(decodeMappings("AAAA,ACAA")).toEqual([
      [
        [0, 0, 0, 0],
        [0, 1, 0, 0],
      ],
    ]);
  });

  test("VLQ com deltas negativos (ex.: '-1' → 1 com sinal)", () => {
    // 'D' = 3 → valor 3; shift 1 → 3 >> 1 = 1, bit 0 de sinal setado → -1
    expect(decodeMappings("D")).toEqual([[[-1]]]);
  });

  test("VLQ inválido lança erro", () => {
    expect(() => decodeMappings("!!")).toThrow();
  });

  test("linhas vazias viram arrays vazios", () => {
    expect(decodeMappings("AAAA;;AACA")).toEqual([[[0, 0, 0, 0]], [], [[0, 0, 1, 0]]]);
  });
});

describe("parseSourceMap", () => {
  test("sourcemap v3 mínimo", () => {
    const map = parseSourceMap({ version: 3, sources: ["a.js"], names: ["f"], mappings: "AAAA" });
    expect(map).not.toBeNull();
    expect(map?.sources).toEqual(["a.js"]);
    expect(map?.names).toEqual(["f"]);
    expect(map?.lines[0]).toEqual([[0, 0, 0, 0]]);
  });

  test("rejeita sem mappings ou com mappings inválidos", () => {
    expect(parseSourceMap({ version: 3 })).toBeNull();
    expect(parseSourceMap(null)).toBeNull();
    expect(parseSourceMap({ mappings: "!!" })).toBeNull();
  });

  test("sourcesContent é preservado", () => {
    const map = parseSourceMap({
      version: 3,
      sources: ["a.js"],
      sourcesContent: ["console.log(1)"],
      mappings: "AAAA",
    });
    expect(map?.sourcesContent).toEqual(["console.log(1)"]);
  });
});

describe("lookupOriginal", () => {
  const map = parseSourceMap({
    version: 3,
    sources: ["dist/app.js"],
    names: ["main"],
    mappings: "AAAAA", // 5 campos: genCol, src, linha, col, name
  })!;

  test("mapeia (1,1) para o source original com nome", () => {
    expect(lookupOriginal(map, 1, 1)).toEqual({
      source: "dist/app.js",
      sourceIndex: 0,
      line: 1,
      col: 1,
      name: "main",
    });
  });

  test("segmento sem name → name null", () => {
    const noName = parseSourceMap({ version: 3, sources: ["a.js"], names: [], mappings: "AAAA" })!;
    expect(lookupOriginal(noName, 1, 1)?.name).toBeNull();
  });

  test("linha inexistente → null", () => {
    expect(lookupOriginal(map, 99, 1)).toBeNull();
  });
});

describe("extractSourceMapUrl", () => {
  test("extrai do comentário no fim do bundle", () => {
    expect(extractSourceMapUrl("const x = 1;\n//# sourceMappingURL=app.js.map")).toBe("app.js.map");
  });

  test("suporta o formato antigo @", () => {
    expect(extractSourceMapUrl("code\n//@ sourceMappingURL=old.map")).toBe("old.map");
  });

  test("data-uri inline → null (não resolve por artefato)", () => {
    expect(
      extractSourceMapUrl("//# sourceMappingURL=data:application/json;base64,AAAA"),
    ).toBeNull();
  });

  test("sem comentário → null", () => {
    expect(extractSourceMapUrl("só código")).toBeNull();
  });
});

describe("resolveMapUrl / normalizeArtifactName / artifactBasename", () => {
  test("resolve url relativo contra o diretório do artefato", () => {
    expect(resolveMapUrl("dist/app.js", "app.js.map")).toBe("dist/app.js.map");
    expect(resolveMapUrl("app.js", "app.js.map")).toBe("app.js.map");
  });

  test("url absoluta não é resolvida", () => {
    expect(resolveMapUrl("dist/app.js", "https://cdn/x.map")).toBe("https://cdn/x.map");
  });

  test("normaliza ~ do sentry-cli, host e query/hash", () => {
    expect(normalizeArtifactName("~/dist/app.js")).toBe("dist/app.js");
    expect(normalizeArtifactName("https://cdn.example.com/assets/app.js?v=2")).toBe(
      "assets/app.js",
    );
    expect(normalizeArtifactName("//cdn.example.com/app.js")).toBe("app.js");
  });

  test("artifactBasename pega o nome do arquivo", () => {
    expect(artifactBasename("dist/app.js.map")).toBe("app.js.map");
    expect(artifactBasename("app.js")).toBe("app.js");
  });
});
