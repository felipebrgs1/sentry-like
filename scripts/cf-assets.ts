/**
 * Combina os builds para o Cloudflare Workers (Static Assets serve um único
 * diretório): copia o dist do docs (Astro, base "/docs") para dentro do
 * web/dist/docs — os links /docs/... passam a resolver no ASSETS.
 * Uso: `bun run build:cf` (roda o build completo + esta cópia).
 */
import { cp, mkdir, rm } from "node:fs/promises";

const WEB_DIST = "apps/web/dist";
const DOCS_DIST = "apps/docs/dist";
const TARGET = `${WEB_DIST}/docs`;

await mkdir(WEB_DIST, { recursive: true });
await rm(TARGET, { recursive: true, force: true });
await cp(DOCS_DIST, TARGET, { recursive: true });
console.log(`[cf-assets] ${DOCS_DIST} → ${TARGET}`);
