/**
 * Proteção contra SSRF para URLs fornecidas por usuários (webhooks de alerta):
 * só http(s), sem credenciais na URL e sem destino em rede privada/loopback/
 * link-local (metadados de cloud em 169.254.169.254, serviços internos etc.).
 */

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isPrivateIpv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return false;
  const [a, b] = p;
  return (
    a === 0 || // "esta" rede
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadados de cloud
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    a >= 224 // multicast + reservado + broadcast
  );
}

function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  // ::ffff:7f00:1 (forma hex do IPv4 mapeado)
  const mappedHex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^(fc|fd|fe[89ab]|ff)/.test(v); // ULA, link-local, multicast
}

/** IP literal em rede não pública? (false para hostnames) */
export function isPrivateAddress(host: string): boolean {
  return isPrivateIpv4(host) || (host.includes(":") && isPrivateIpv6(host));
}

/** Valida a URL de um webhook. Retorna mensagem de erro ou null se ok. */
export function webhookUrlError(raw: string, allowPrivate: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "URL inválida";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "use http(s)://";
  if (url.username || url.password) return "credenciais na URL não são permitidas";
  if (allowPrivate) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || isPrivateAddress(host)) {
    return "destino em rede privada/local bloqueado (ALLOW_PRIVATE_WEBHOOKS=1 libera)";
  }
  return null;
}

/**
 * Resolve o hostname e recusa se QUALQUER endereço for privado (evita
 * hostname público apontando para 127.0.0.1). Sem `node:dns` (Workers) só a
 * checagem literal vale — o fetch da Cloudflare não alcança redes privadas.
 */
export async function resolvesToPrivate(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isPrivateAddress(host)) return true;
  let lookup: ((h: string, o: { all: true }) => Promise<{ address: string }[]>) | undefined;
  try {
    ({ lookup } = await import("node:dns/promises"));
  } catch {
    return false;
  }
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.some((a) => isPrivateAddress(a.address));
  } catch {
    return false; // não resolve → o fetch falha sozinho
  }
}
