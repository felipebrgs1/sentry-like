import type {
  EventDetail,
  Issue,
  SentryBreadcrumb,
  SentryEvent,
  SentryTags,
} from "@sentrylike/shared";

/**
 * Monta um prompt em markdown pronto para colar num agente de IA (LLM),
 * com o contexto completo de uma issue: exceção, stack trace, breadcrumbs,
 * tags e detalhes do evento.
 */

function normalizeTags(tags: SentryTags | undefined): Array<[string, string]> {
  if (!tags) return [];
  return Array.isArray(tags) ? tags : Object.entries(tags);
}

function normalizeBreadcrumbs(bc: SentryEvent["breadcrumbs"]): SentryBreadcrumb[] {
  if (!bc) return [];
  return Array.isArray(bc) ? bc : (bc.values ?? []);
}

/** JSON compacto com limite de tamanho (não estoura o prompt). */
function jsonBlock(label: string, data: unknown, maxChars = 1500): string {
  if (data == null) return "";
  let text: string;
  try {
    text = JSON.stringify(data, null, 2);
  } catch {
    return "";
  }
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n… (truncado)";
  return `\n### ${label}\n\`\`\`json\n${text}\n\`\`\`\n`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR");
}

export function buildAgentPrompt(input: {
  issue: Issue;
  projectName?: string;
  event?: EventDetail | null;
  events?: Array<{
    timestamp: number;
    environment: string | null;
    release: string | null;
    level: string;
  }>;
}): string {
  const { issue, projectName, event } = input;
  const p = event?.payload;
  const lines: string[] = [];

  lines.push(`# Issue: ${issue.title}`);
  lines.push("");
  lines.push(
    [
      projectName ? `**Projeto**: ${projectName}` : null,
      `**Nível**: ${issue.level}`,
      `**Prioridade**: ${issue.priority}`,
      `**Status**: ${issue.status}`,
      issue.environment ? `**Ambiente**: ${issue.environment}` : null,
      issue.release ? `**Release**: ${issue.release}` : null,
      `**Eventos**: ${issue.eventCount}`,
      `**Primeira**: ${fmtTime(issue.firstSeen)}`,
      `**Última**: ${fmtTime(issue.lastSeen)}`,
      p?.sdk ? `**SDK**: ${p.sdk.name}@${p.sdk.version ?? ""}` : null,
    ]
      .filter((x): x is string => x !== null)
      .join(" · "),
  );
  lines.push("");
  if (issue.culprit) {
    lines.push(`**Culpado**: ${issue.culprit}`);
    lines.push("");
  }

  // exceção + stack trace (frames mais recentes primeiro)
  const exc = p?.exception?.values?.[0];
  if (exc) {
    lines.push(`## Exceção`);
    lines.push("");
    lines.push(`**${exc.type ?? "Error"}**: ${exc.value ?? ""}`.trim());
    lines.push("");
    const frames = exc.stacktrace?.frames ?? [];
    if (frames.length) {
      lines.push("## Stack trace");
      lines.push("");
      lines.push("```");
      for (const f of frames.toReversed()) {
        const loc = f.filename ?? f.abs_path ?? "?";
        const lineNo =
          f.lineno != null ? `:${f.lineno}${f.colno != null ? `:${f.colno}` : ""}` : "";
        const tag = f.in_app ? "" : " [lib]";
        lines.push(`at ${f.function ?? "anonymous"} (${loc}${lineNo})${tag}`);
      }
      lines.push("```");
      lines.push("");
    }
  } else if (p?.message) {
    lines.push(`## Mensagem`);
    lines.push("");
    lines.push(p.message);
    lines.push("");
  }

  // breadcrumbs
  const breadcrumbs = normalizeBreadcrumbs(p?.breadcrumbs);
  if (breadcrumbs.length) {
    lines.push("## Breadcrumbs");
    lines.push("");
    for (const b of breadcrumbs) {
      const t = b.timestamp ? new Date(b.timestamp * 1000).toLocaleTimeString("pt-BR") : "—";
      lines.push(
        `- ${t} [${b.category ?? b.type ?? "log"}] ${b.message ?? JSON.stringify(b.data ?? {})}`,
      );
    }
    lines.push("");
  }

  // tags
  const tags = normalizeTags(p?.tags);
  if (tags.length) {
    lines.push("## Tags");
    lines.push("");
    for (const [k, v] of tags) lines.push(`- ${k}: ${v}`);
    lines.push("");
  }

  // JSON auxiliar (truncado)
  const json: Array<[string, unknown]> = [
    ["User", p?.user],
    ["Request", p?.request],
    ["Contexts", p?.contexts],
    ["Extra", p?.extra],
  ];
  for (const [label, data] of json) {
    const block = jsonBlock(label, data);
    if (block) {
      lines.push(block);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}
