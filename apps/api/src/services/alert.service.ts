import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { AlertLog, AlertRule, AlertRuleType, WebhookType } from "@sentrylike/shared";
import { db } from "../db";
import { alertLogs, alertRules, events, issues, projects } from "../db/schema";
import { sendAlert } from "../lib/notify";
import { APP_URL, RATE_LIMIT_PER_MIN } from "../config";

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export async function listAlertRules(projectId: number): Promise<AlertRule[]> {
  const rows = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.projectId, projectId))
    .orderBy(desc(alertRules.createdAt))
    .all();
  return rows.map((r) => ({ ...r, config: JSON.parse(r.config) }));
}

export async function getAlertRule(id: number): Promise<AlertRule | undefined> {
  const row = await db.select().from(alertRules).where(eq(alertRules.id, id)).get();
  return row ? { ...row, config: JSON.parse(row.config) } : undefined;
}

export async function createAlertRule(input: {
  projectId: number;
  name: string;
  type: AlertRuleType;
  config: Record<string, unknown>;
  webhookType: WebhookType;
  webhookUrl: string;
  enabled?: number;
}): Promise<AlertRule> {
  const row = await db
    .insert(alertRules)
    .values({
      projectId: input.projectId,
      name: input.name.trim().slice(0, 120),
      type: input.type,
      config: JSON.stringify(input.config ?? {}),
      webhookType: input.webhookType,
      webhookUrl: input.webhookUrl.trim().slice(0, 500),
      enabled: input.enabled ?? 1,
      createdAt: Date.now(),
    })
    .returning({ id: alertRules.id })
    .get();
  const created = await getAlertRule(row.id);
  return created!;
}

export async function updateAlertRule(
  id: number,
  patch: Partial<{
    name: string;
    config: Record<string, unknown>;
    webhookType: WebhookType;
    webhookUrl: string;
    enabled: number;
  }>,
): Promise<boolean> {
  const existing = await db.select().from(alertRules).where(eq(alertRules.id, id)).get();
  if (!existing) return false;
  await db
    .update(alertRules)
    .set({
      name: patch.name?.trim() || existing.name,
      config: patch.config ? JSON.stringify(patch.config) : existing.config,
      webhookType: patch.webhookType ?? existing.webhookType,
      webhookUrl: patch.webhookUrl?.trim() || existing.webhookUrl,
      enabled: patch.enabled ?? existing.enabled,
    })
    .where(eq(alertRules.id, id))
    .run();
  return true;
}

export async function deleteAlertRule(id: number): Promise<boolean> {
  const existing = await db.select().from(alertRules).where(eq(alertRules.id, id)).get();
  if (!existing) return false;
  await db.delete(alertRules).where(eq(alertRules.id, id)).run();
  return true;
}

export async function listAlertLogs(projectId: number, limit = 50): Promise<AlertLog[]> {
  const rows = await db
    .select()
    .from(alertLogs)
    .where(eq(alertLogs.projectId, projectId))
    .orderBy(desc(alertLogs.sentAt))
    .limit(limit)
    .all();
  return rows.map((r) => ({
    ...r,
    status: r.status === "error" ? "error" : "ok",
  }));
}

// ------------------------------------------------------------------
// Disparo
// ------------------------------------------------------------------

/** Envia uma mensagem de teste sem gravar no histórico. */
export async function testAlertRule(
  rule: AlertRule,
  nomeProjeto: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  return sendAlert(rule, {
    rule: rule.name,
    type: "test",
    project: nomeProjeto,
    title: "🧪 Teste de alerta — sentrylike",
    severity: "warning",
    firedAt: Date.now(),
  });
}

/** Dedupe: a mesma regra + issue não dispara de novo dentro de 24h. */
async function alreadyFired(
  ruleId: number,
  issueId: number | null,
  withinMs = 24 * 3600_000,
): Promise<boolean> {
  const since = Date.now() - withinMs;
  const row = await db
    .select({ id: alertLogs.id })
    .from(alertLogs)
    .where(
      and(
        eq(alertLogs.ruleId, ruleId),
        issueId == null ? isNull(alertLogs.issueId) : eq(alertLogs.issueId, issueId),
        gt(alertLogs.sentAt, since),
      ),
    )
    .get();
  return !!row;
}

async function fire(
  rule: AlertRule,
  title: string,
  opts: {
    issueId?: number | null;
    severity?: string;
    details?: Record<string, unknown>;
    issueUrl?: string;
    projectName: string;
  },
): Promise<void> {
  const result = await sendAlert(rule, {
    rule: rule.name,
    type: rule.type,
    project: opts.projectName,
    title,
    severity: opts.severity ?? "warning",
    issueUrl: opts.issueUrl,
    details: opts.details,
    firedAt: Date.now(),
  });
  await db
    .insert(alertLogs)
    .values({
      ruleId: rule.id,
      projectId: rule.projectId,
      issueId: opts.issueId ?? null,
      type: rule.type,
      title: title.slice(0, 300),
      sentAt: Date.now(),
      status: result.ok ? "ok" : "error",
      response: result.ok ? null : result.body,
    })
    .run();
  await db
    .update(alertRules)
    .set({ lastFiredAt: Date.now() })
    .where(eq(alertRules.id, rule.id))
    .run();
}

/** Dispara alertas de ingestão (new_issue / regression) — chamado pelo ingest. */
export async function fireIngestAlerts(
  projectId: number,
  kind: "new_issue" | "regression",
  issue: { id: number; title: string; level: string; lastSeen: number },
): Promise<void> {
  const rules = await listAlertRules(projectId);
  const matching = rules.filter((r) => r.enabled && r.type === kind);
  if (!matching.length) return;
  const pname = await projectName(projectId);
  for (const rule of matching) {
    if (await alreadyFired(rule.id, issue.id)) continue;
    await fire(rule, `${kind === "new_issue" ? "Nova issue" : "Regressão"}: ${issue.title}`, {
      issueId: issue.id,
      severity: kind === "regression" ? "high" : issue.level === "fatal" ? "high" : "warning",
      projectName: pname,
      issueUrl: `${APP_URL}/issues/${issue.id}`,
      details: { level: issue.level, last_seen: new Date(issue.lastSeen).toLocaleString("pt-BR") },
    });
  }
}

// ------------------------------------------------------------------
// Checks periódicos (spike, unresolved_age, rate_limit, daily_digest)
// ------------------------------------------------------------------

async function enabledRulesOfType(type: AlertRuleType): Promise<AlertRule[]> {
  const rows = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.enabled, 1), eq(alertRules.type, type)))
    .all();
  return rows.map((r) => ({ ...r, config: JSON.parse(r.config) }));
}

function cfgNumber(rule: AlertRule, key: string, def: number): number {
  const v = rule.config[key];
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

/** Rodado periodicamente (VPS setInterval / CF cron). Idempotente. */
export async function runAlertChecks(): Promise<void> {
  const now = Date.now();

  // --- frequency_spike: eventos da janela atual vs janela anterior ---
  const spikeRules = await enabledRulesOfType("frequency_spike");
  for (const rule of spikeRules) {
    const windowMs = cfgNumber(rule, "window_minutes", 10) * 60_000;
    const threshold = cfgNumber(rule, "threshold", 3);
    const minEvents = cfgNumber(rule, "min_events", 10);
    if (rule.lastFiredAt && now - rule.lastFiredAt < windowMs) continue; // cooldown = janela

    const current = await countEventsSince(rule.projectId, now - windowMs);
    const previous = await countEventsSince(rule.projectId, now - 2 * windowMs, now - windowMs);
    if (current >= minEvents && previous > 0 && current >= previous * threshold) {
      const pname = await projectName(rule.projectId);
      await fire(
        rule,
        `Pico de eventos (${current} em ${cfgNumber(rule, "window_minutes", 10)}min, ${previous} antes)`,
        {
          projectName: pname,
          details: {
            window_min: cfgNumber(rule, "window_minutes", 10),
            current,
            previous,
            threshold,
          },
        },
      );
    }
  }

  // --- unresolved_age: issue aberta há X dias ---
  const ageRules = await enabledRulesOfType("unresolved_age");
  for (const rule of ageRules) {
    const days = cfgNumber(rule, "days", 3);
    const cutoff = now - days * 24 * 3600_000;
    const candidates = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.projectId, rule.projectId),
          isNull(issues.mergedInto),
          lt(issues.firstSeen, cutoff),
          or(
            eq(issues.status, "unresolved"),
            sql`(${issues.status} = 'ignored' AND ${issues.ignoredUntil} IS NOT NULL AND ${issues.ignoredUntil} < ${now})`,
          ),
        ),
      )
      .all();
    for (const issue of candidates) {
      if (await alreadyFired(rule.id, issue.id)) continue;
      const pname = await projectName(rule.projectId);
      await fire(rule, `Issue sem resolver há ${days}d: ${issue.title}`, {
        issueId: issue.id,
        projectName: pname,
        issueUrl: `${APP_URL}/issues/${issue.id}`,
        details: {
          dias_aberta: days,
          events: issue.eventCount,
          first_seen: new Date(issue.firstSeen).toLocaleString("pt-BR"),
        },
      });
    }
  }

  // --- rate_limit: ingestão perto do limite do projeto ---
  const rateRules = await enabledRulesOfType("rate_limit");
  for (const rule of rateRules) {
    if (rule.lastFiredAt && now - rule.lastFiredAt < 3600_000) continue; // 1x/hora
    const lastMinute = await countEventsSince(rule.projectId, now - 60_000);
    const pct = Math.round((lastMinute / RATE_LIMIT_PER_MIN) * 100);
    if (lastMinute >= RATE_LIMIT_PER_MIN * 0.8) {
      const pname = await projectName(rule.projectId);
      await fire(rule, `Ingestão perto do limite (${pct}% em 1min)`, {
        projectName: pname,
        severity: "high",
        details: { eventos_1min: lastMinute, limite: RATE_LIMIT_PER_MIN, pct },
      });
    }
  }

  // --- daily_digest: resumo das últimas 24h (cooldown 22h) ---
  const digestRules = await enabledRulesOfType("daily_digest");
  for (const rule of digestRules) {
    if (rule.lastFiredAt && now - rule.lastFiredAt < 22 * 3600_000) continue;
    const pname = await projectName(rule.projectId);
    const digest = await buildDigest(rule.projectId);
    await fire(rule, `Resumo diário — ${pname}`, {
      projectName: pname,
      details: digest,
    });
  }
}

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

async function countEventsSince(projectId: number, since: number, until?: number): Promise<number> {
  return (
    (
      await db
        .select({ c: sql<number>`count(*)` })
        .from(events)
        .where(
          and(
            eq(events.projectId, projectId),
            gt(events.timestamp, since),
            until ? lt(events.timestamp, until) : sql`1=1`,
          ),
        )
        .get()
    )?.c ?? 0
  );
}

async function projectName(projectId: number): Promise<string> {
  const p = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  return p?.name ?? `#${projectId}`;
}

async function buildDigest(projectId: number): Promise<Record<string, unknown>> {
  const now = Date.now();
  const d24 = now - 24 * 3600_000;

  const newIssues =
    (
      await db
        .select({ c: sql<number>`count(*)` })
        .from(issues)
        .where(and(eq(issues.projectId, projectId), gt(issues.firstSeen, d24)))
        .get()
    )?.c ?? 0;
  const events24h = await countEventsSince(projectId, d24);

  const topIssues = await db
    .select({ title: issues.title, count: issues.eventCount })
    .from(issues)
    .where(and(eq(issues.projectId, projectId), isNull(issues.mergedInto)))
    .orderBy(desc(issues.lastSeen))
    .limit(5)
    .all();

  return {
    novas_issues_24h: newIssues,
    eventos_24h: events24h,
    top_issues: topIssues.map((i) => `${i.title} (${i.count})`).join("; ") || "nenhum",
  };
}
