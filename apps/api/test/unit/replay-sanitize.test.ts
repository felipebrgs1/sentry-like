/**
 * Unit: sanitização do player de replay (apps/web/src/lib/replay.ts).
 * O DOM do replay vem do SDK com a key PÚBLICA do DSN — qualquer um pode
 * enviar; o HTML gerado não pode carregar handlers nem scripts.
 */
import { describe, expect, test } from "bun:test";
import { renderNodeHtml, replaySrcDoc } from "../../../web/src/lib/replay";

const img = (attributes: Record<string, string>) => ({
  type: 2,
  id: 1,
  tagName: "img",
  attributes,
});

describe("renderNodeHtml", () => {
  test("nome de atributo com espaço/= não injeta handler", () => {
    const html = renderNodeHtml(img({ src: "x", "x onerror=alert(document.cookie) y": "1" }));
    expect(html).not.toContain("onerror");
    expect(html).toBe('<img src="x">');
  });

  test("handlers on* e javascript: são removidos", () => {
    const html = renderNodeHtml({
      type: 2,
      id: 1,
      tagName: "a",
      attributes: { onclick: "alert(1)", OnMouseOver: "x", href: " JavaScript:alert(1)" },
      childNodes: [{ type: 3, id: 2, textContent: "<b>oi</b>" }],
    });
    expect(html).toBe("<a>&lt;b&gt;oi&lt;/b&gt;</a>");
  });

  test("tag script vira span inerte", () => {
    const html = renderNodeHtml({
      type: 2,
      id: 1,
      tagName: "script",
      childNodes: [{ type: 3, id: 2, textContent: "alert(1)" }],
    });
    expect(html).not.toContain("<script");
  });
});

describe("replaySrcDoc", () => {
  test("documento do iframe tem CSP sem rede", () => {
    const doc = replaySrcDoc("<p>x</p>");
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain("script-src");
  });
});
