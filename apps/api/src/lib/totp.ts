/**
 * TOTP (RFC 6238) — HMAC-SHA1, 6 dígitos, janela de 30s.
 * Portável: usa crypto.subtle (Web Crypto), funciona em Bun e Workers.
 * Sem lib de QR — a URI otpauth:// é mostrada em texto (autenticadores
 * aceitam colar a chave manualmente).
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toB32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function fromB32(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** Gera um segredo TOTP (20 bytes → base32, 32 chars). */
export function generateTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return toB32(bytes);
}

export function provisioningUri(secret: string, email: string): string {
  const label = encodeURIComponent(`sentrylike:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=sentrylike&algorithm=SHA1&digits=6&period=30`;
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const keyBuf = key as unknown as Uint8Array<ArrayBuffer>;
  const dataBuf = data as unknown as Uint8Array<ArrayBuffer>;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, dataBuf);
  return new Uint8Array(sig);
}

async function totpAt(secret: string, counter: number): Promise<string> {
  const key = fromB32(secret);
  const buf = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = await hmacSha1(key, buf);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Verifica o código com tolerância de ±1 janela (30s). */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 30_000);
  for (let i = -1; i <= 1; i++) {
    if ((await totpAt(secret, counter + i)) === code) return true;
  }
  return false;
}
