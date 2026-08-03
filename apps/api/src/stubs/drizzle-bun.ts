/**
 * Stub do driver drizzle bun-sqlite para o bundle da Cloudflare.
 * O initBunDb() nunca roda num Worker; se cair aqui, é bug de configuração.
 */
export function drizzle() {
  throw new Error("drizzle-orm/bun-sqlite is not available on Cloudflare Workers — use D1");
}
