import type { HandlerContext } from "./types";
import * as alertService from "../services/alert.service";
import * as projectService from "../services/project.service";
import type { AlertRuleType, WebhookType } from "@sentrylike/shared";

const RULE_TYPES: AlertRuleType[] = [
  "new_issue",
  "regression",
  "frequency_spike",
  "unresolved_age",
  "rate_limit",
  "daily_digest",
];
const WEBHOOK_TYPES: WebhookType[] = ["generic", "slack", "discord"];

/** GET /v1/projects/:id/alert-rules */
export async function list({ params }: Pick<HandlerContext, "params">) {
  return alertService.listAlertRules(Number(params.id));
}

/** POST /v1/projects/:id/alert-rules */
export async function create({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set">) {
  const b = (body ?? {}) as {
    name?: string;
    type?: string;
    config?: Record<string, unknown>;
    webhookType?: string;
    webhookUrl?: string;
  };
  if (!b.name?.trim() || !RULE_TYPES.includes(b.type as AlertRuleType)) {
    set.status = 400;
    return { error: "name and a valid type are required" };
  }
  if (!b.webhookUrl?.trim() || !WEBHOOK_TYPES.includes(b.webhookType as WebhookType)) {
    set.status = 400;
    return { error: "webhookType and webhookUrl are required" };
  }
  return alertService.createAlertRule({
    projectId: Number(params.id),
    name: b.name,
    type: b.type as AlertRuleType,
    config: b.config ?? {},
    webhookType: b.webhookType as WebhookType,
    webhookUrl: b.webhookUrl,
  });
}

/** PATCH /v1/alerts/:id */
export async function update({
  params,
  body,
  set,
}: Pick<HandlerContext, "params" | "body" | "set">) {
  const b = (body ?? {}) as {
    name?: string;
    config?: Record<string, unknown>;
    webhookType?: string;
    webhookUrl?: string;
    enabled?: number;
  };
  if (b.enabled !== undefined && ![0, 1].includes(b.enabled)) {
    set.status = 400;
    return { error: "enabled must be 0 or 1" };
  }
  if (
    !(await alertService.updateAlertRule(Number(params.id), {
      name: b.name,
      config: b.config,
      webhookType: b.webhookType as WebhookType | undefined,
      webhookUrl: b.webhookUrl,
      enabled: b.enabled,
    }))
  ) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}

/** DELETE /v1/alerts/:id */
export async function remove({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!(await alertService.deleteAlertRule(Number(params.id)))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}

/** POST /v1/alerts/:id/test — envia mensagem de teste no canal */
export async function test({ params, set }: Pick<HandlerContext, "params" | "set">) {
  const rule = await alertService.getAlertRule(Number(params.id));
  if (!rule) {
    set.status = 404;
    return { error: "not found" };
  }
  const project = await projectService.getProject(rule.projectId);
  const result = await alertService.testAlertRule(rule, project?.name ?? `#${rule.projectId}`);
  return result;
}

/** GET /v1/projects/:id/alert-logs */
export async function logs({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const limit = Math.min(Math.max(Number(query?.limit ?? 50), 1), 200);
  return alertService.listAlertLogs(Number(params.id), limit);
}
