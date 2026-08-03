import type { RrwebEvent } from "@sentrylike/shared";

/**
 * Player básico de replay (Fase 9) — sem dependências.
 * Reconstrução do DOM a partir dos eventos rrweb (FullSnapshot +
 * IncrementalSnapshot/Mutation) + renderização sanitizada (os dados vêm de
 * SDKs de terceiros: todo texto/atributo é escapado, tags e atributos
 * perigosos são bloqueados).
 */

interface RrwebNode {
  type: number; // 1=Document, 2=Element, 3=Text
  id: number;
  tagName?: string;
  attributes?: Record<string, string>;
  childNodes?: RrwebNode[];
  textContent?: string;
  parentId?: number;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ALLOWED_TAGS = new Set([
  "html",
  "head",
  "body",
  "div",
  "span",
  "p",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "small",
  "sub",
  "sup",
  "mark",
  "code",
  "pre",
  "blockquote",
  "q",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "optgroup",
  "label",
  "fieldset",
  "legend",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "figure",
  "figcaption",
  "time",
  "address",
  "details",
  "summary",
  "dialog",
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "g",
  "defs",
  "use",
  "text",
  "title",
]);

const UNTRUSTED_URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "srcdoc",
  "poster",
  "data",
  "xlink:href",
]);

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Serializa a árvore de nós em HTML seguro. */
export function renderNodeHtml(node: RrwebNode | null | undefined): string {
  if (!node) return "";
  if (node.type === 3) return esc(node.textContent ?? "");
  if (node.type !== 2) {
    // Document (type 1) — container sem tag
    return (node.childNodes ?? []).map(renderNodeHtml).join("");
  }
  const tag = (node.tagName ?? "div").toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    return `<span data-replay-tag="${esc(tag)}" title="tag bloqueada">${(node.childNodes ?? [])
      .map(renderNodeHtml)
      .join("")}</span>`;
  }
  const attrs = node.attributes ?? {};
  let html = `<${tag}`;
  for (const [k, raw] of Object.entries(attrs)) {
    const lk = k.toLowerCase();
    if (lk.startsWith("on")) continue; // handlers de evento — nunca
    const v = String(raw);
    if (UNTRUSTED_URL_ATTRS.has(lk)) {
      const low = v.trim().toLowerCase();
      if (
        low.startsWith("javascript:") ||
        low.startsWith("vbscript:") ||
        low.startsWith("data:text/html")
      ) {
        continue;
      }
      html += ` ${k}="${esc(v)}"`;
      continue;
    }
    if (lk === "style") {
      if (/expression\s*\(|javascript\s*:/i.test(v)) continue;
      html += ` style="${esc(v)}"`;
      continue;
    }
    html += ` ${k}="${esc(v)}"`;
  }
  const children = (node.childNodes ?? []).map(renderNodeHtml).join("");
  if (VOID_TAGS.has(tag)) return `${html}>`;
  return `${html}>${children}</${tag}>`;
}

/**
 * Engine de reconstrução: aplica os eventos rrweb em ordem e expõe o HTML
 * do estado atual. Rebuild ao voltar no tempo; incremental ao avançar.
 */
export class ReplayEngine {
  events: RrwebEvent[];
  private nodes = new Map<number, RrwebNode>();
  private root: RrwebNode | null = null;
  private applied = 0;

  constructor(events: RrwebEvent[]) {
    this.events = [...events].toSorted((a, b) => a.timestamp - b.timestamp);
  }

  get count(): number {
    return this.events.length;
  }

  /** Aplica os eventos até o índice (inclusive). Voltar no tempo faz rebuild. */
  applyTo(index: number): void {
    const target = Math.max(0, Math.min(index, this.events.length));
    if (target < this.applied) {
      this.nodes.clear();
      this.root = null;
      this.applied = 0;
    }
    while (this.applied < target && this.applied < this.events.length) {
      this.applyEvent(this.events[this.applied]);
      this.applied++;
    }
  }

  html(): string {
    return renderNodeHtml(this.root);
  }

  private applyEvent(e: RrwebEvent): void {
    if (e.type === 2) {
      // FullSnapshot
      this.root = e.data.node as RrwebNode;
      this.nodes.clear();
      if (this.root) this.indexNodes(this.root);
    } else if (e.type === 3) {
      const d = e.data as {
        source?: number;
        adds?: Array<{ parentId: number; nextId: number | null; node: RrwebNode }>;
        removes?: Array<{ id: number }>;
        moves?: Array<{ parentId: number; nextId: number | null; node: RrwebNode }>;
        texts?: Array<{ id: number; value: string }>;
        attributes?: Array<{ id: number; attributes: Record<string, string> }>;
      };
      if (d.source !== 0) return; // só mutations por enquanto
      for (const a of d.adds ?? []) this.addNode(a);
      for (const r of d.removes ?? []) this.removeNode(r.id);
      for (const m of d.moves ?? []) this.moveNode(m);
      for (const t of d.texts ?? []) {
        const n = this.nodes.get(t.id);
        if (n) n.textContent = String(t.value ?? "");
      }
      for (const at of d.attributes ?? []) {
        const n = this.nodes.get(at.id);
        if (n) n.attributes = { ...n.attributes, ...at.attributes };
      }
    }
  }

  private indexNodes(node: RrwebNode): void {
    this.nodes.set(node.id, node);
    for (const c of node.childNodes ?? []) {
      c.parentId = node.id;
      this.indexNodes(c);
    }
  }

  private addNode(a: { parentId: number; nextId: number | null; node: RrwebNode }): void {
    const parent = this.nodes.get(a.parentId);
    if (!parent) return;
    const node = a.node;
    node.parentId = a.parentId;
    this.indexNodes(node);
    const siblings = parent.childNodes ?? (parent.childNodes = []);
    if (a.nextId != null) {
      const idx = siblings.findIndex((c) => c.id === a.nextId);
      if (idx >= 0) siblings.splice(idx, 0, node);
      else siblings.push(node);
    } else {
      siblings.push(node);
    }
  }

  private removeNode(id: number): void {
    const n = this.nodes.get(id);
    if (!n) {
      this.nodes.delete(id);
      return;
    }
    if (n.parentId != null) {
      const parent = this.nodes.get(n.parentId);
      if (parent?.childNodes) {
        parent.childNodes = parent.childNodes.filter((c) => c.id !== id);
      }
    }
    this.deleteSubtree(n);
  }

  private moveNode(m: { parentId: number; nextId: number | null; node: RrwebNode }): void {
    this.removeNode(m.node.id);
    this.addNode(m);
  }

  private deleteSubtree(n: RrwebNode): void {
    for (const c of n.childNodes ?? []) this.deleteSubtree(c);
    this.nodes.delete(n.id);
  }
}
