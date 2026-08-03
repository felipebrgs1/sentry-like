/**
 * Stub para o bundle da Cloudflare: o driver bun:sqlite só roda no Bun (VPS).
 * O wrangler.toml faz alias de "bun:sqlite" para cá — se chamado num Worker,
 * é erro de configuração (o worker deve usar D1 via initD1Db).
 */
export function Database() {
  throw new Error("bun:sqlite is not available on Cloudflare Workers — use D1 (initD1Db)");
}
