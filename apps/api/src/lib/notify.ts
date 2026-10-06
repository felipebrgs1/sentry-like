import type { AlertRule, WebhookType } from "@sentrylike/shared";
import { APP_URL, allowPrivateWebhooks } from "../config";
import { resolvesToPrivate, webhookUrlError } from "./netguard";

/**
 * Envio de alertas para webhooks (genérico, Slack, Discord).
 * Usa fetch — portável entre Bun (VPS) e Cloudflare Workers.
 */

export interface AlertPayload {
  rule: string;
  type: string;
  project: string;
  title: string;
  severity: string;
  issueUrl?: string;
  details?: Record<string, unknown>;
  firedAt: number;
}

const line = (k: string, v: string) => `• *${k}*: ${v}`;

function formatBody(channel: WebhookType, p: AlertPayload): string {
  switch (channel) {
    case "slack":
      return JSON.stringify({
        text: `:rotating_light: [${p.project}] ${p.title}`,
        attachments: [
          {
            color: p.severity === "high" ? "danger" : "warning",
            fields: [
              { title: "Regra", value: p.rule, short: true },
              { title: "Tipo", value: p.type, short: true },
              { title: "Projeto", value: p.project, short: true },
              { title: "Quando", value: new Date(p.firedAt).toLocaleString("pt-BR"), short: true },
              ...(p.details
                ? Object.entries(p.details).map(([k, v]) => ({
                    title: k,
                    value: String(v),
                    short: true,
                  }))
                : []),
            ],
            footer: p.issueUrl ?? APP_URL,
          },
        ],
      });
    case "discord":
      return JSON.stringify({
        content: `**${p.title}**`,
        embeds: [
          {
            title: `${p.project} — ${p.type}`,
            description: [
              line("Regra", p.rule),
              line("Quando", new Date(p.firedAt).toLocaleString("pt-BR")),
            ].join("\n"),
            url: p.issueUrl ?? APP_URL,
            color: p.severity === "high" ? 0xe11d48 : 0xf59e0b,
            fields: p.details
              ? Object.entries(p.details).map(([k, v]) => ({
                  name: k,
                  value: String(v),
                  inline: true,
                }))
              : undefined,
          },
        ],
      });
    default:
      return JSON.stringify({ ...p, firedAt: new Date(p.firedAt).toISOString() });
  }
}

/**
 * Envia o alerta; retorna { ok, status, body } para logar.
 * Anti-SSRF: destino privado é recusado (checado de novo no envio, pois o DNS
 * pode mudar), redirects não são seguidos e o corpo da resposta NUNCA volta
 * para quem configurou o webhook — só o status HTTP.
 */
export async function sendAlert(
  rule: AlertRule,
  payload: AlertPayload,
): Promise<{ ok: boolean; status: number; body: string }> {
  const allowPrivate = allowPrivateWebhooks();
  const invalid = webhookUrlError(rule.webhookUrl, allowPrivate);
  if (invalid) return { ok: false, status: 0, body: `bloqueado: ${invalid}` };
  if (!allowPrivate && (await resolvesToPrivate(new URL(rule.webhookUrl).hostname))) {
    return { ok: false, status: 0, body: "bloqueado: host resolve para rede privada" };
  }
  try {
    const res = await fetch(rule.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: formatBody(rule.webhookType, payload),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => {});
    return { ok: res.ok, status: res.status, body: `HTTP ${res.status}` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    return { ok: false, status: 0, body: name === "TimeoutError" ? "timeout" : "falha de rede" };
  }
}
