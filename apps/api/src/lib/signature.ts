/**
 * Verificação de webhooks assinados (Web Crypto — portável Bun/Workers).
 */

const enc = new TextEncoder();

/** Comparação em tempo constante (não vaza o prefixo correto por timing). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, body as unknown as Uint8Array<ArrayBuffer>),
  );
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Webhook de deploy aceita:
 * - GitHub: `X-Hub-Signature-256: sha256=<hmac-hex do corpo>`
 * - GitLab: `X-Gitlab-Token: <segredo>`
 * - genérico (CI/curl): `X-Sentrylike-Token: <segredo>`
 */
export async function verifyDeployWebhook(
  secret: string,
  body: Uint8Array,
  headers: Headers,
): Promise<boolean> {
  const github = headers.get("x-hub-signature-256");
  if (github) {
    return timingSafeEqual(github, `sha256=${await hmacSha256Hex(secret, body)}`);
  }
  const token = headers.get("x-gitlab-token") ?? headers.get("x-sentrylike-token");
  return token !== null && timingSafeEqual(token, secret);
}
