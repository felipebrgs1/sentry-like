// ------------------------------------------------------------------
// Sentry protocol types (subset we actually consume)
// ------------------------------------------------------------------

export interface SentryStackFrame {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  vars?: Record<string, unknown>;
}

export interface SentryExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: SentryStackFrame[] };
}

export interface SentrySpan {
  span_id?: string;
  trace_id?: string;
  parent_span_id?: string;
  op?: string;
  description?: string;
  status?: string;
  start_timestamp?: number;
  timestamp?: number;
  data?: Record<string, unknown>;
}

export interface SentryBreadcrumb {
  timestamp?: number;
  type?: string;
  category?: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export type SentryTags = Record<string, string> | Array<[string, string]>;

export interface SentryEvent {
  event_id?: string;
  type?: string; // "error" | "transaction" | ...
  fingerprint?: string[]; // fingerprint custom enviado pelo SDK
  start_timestamp?: number | string; // transactions: início em segundos
  spans?: SentrySpan[]; // transactions: filhos
  measurements?: Record<string, { value?: number; unit?: string }>; // web vitals
  timestamp?: number | string;
  platform?: string;
  level?: string;
  logger?: string;
  message?: string;
  logentry?: { formatted?: string; message?: string };
  exception?: { values?: SentryExceptionValue[] };
  culprit?: string;
  transaction?: string;
  release?: string;
  environment?: string;
  server_name?: string;
  tags?: SentryTags;
  contexts?: Record<string, unknown>;
  breadcrumbs?: SentryBreadcrumb[] | { values?: SentryBreadcrumb[] };
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
  sdk?: { name?: string; version?: string };
  extra?: Record<string, unknown>;
}

export interface EnvelopeItemHeader {
  type?: string;
  length?: number;
  content_type?: string;
  filename?: string;
}

// ------------------------------------------------------------------
// Dashboard API types
// ------------------------------------------------------------------

export interface Project {
  id: number;
  name: string;
  publicKey: string;
  allowedDomains: string | null;
  createdAt: number;
}

export interface ProjectWithStats extends Project {
  dsn: string;
  issueCount: number;
  events24h: number;
}

export type IssueStatus = "unresolved" | "resolved" | "ignored" | "merged";

export type IssuePriority = "low" | "medium" | "high";

export interface Issue {
  id: number;
  projectId: number;
  fingerprint: string;
  title: string;
  culprit: string | null;
  level: string;
  status: IssueStatus;
  environment: string | null;
  release: string | null;
  firstSeen: number;
  lastSeen: number;
  eventCount: number;
  /** Quando a janela de "ignorar por X" expira (ms epoch). null = sem janela. */
  ignoredUntil: number | null;
  /** 1 = reabriu depois de resolvida (badge de regressão). */
  regressed: number;
  priority: IssuePriority;
  /** 1 = não lida (atividade nova desde a última visita). */
  unread: number;
  /** null = visível; id = foi mesclada nesta issue (oculta). */
  mergedInto: number | null;
  /** Owner/atribuído (texto livre até a fase multi-user). */
  assignedTo: string | null;
}

/** Paginação com cursor: `nextCursor` null = acabou. */
export interface IssuePage {
  items: Issue[];
  nextCursor: string | null;
}

export interface SavedSearchFilters {
  status?: string;
  q?: string;
  level?: string;
  env?: string;
  release?: string;
}

export interface SavedSearch {
  id: number;
  projectId: number;
  name: string;
  filters: SavedSearchFilters;
  createdAt: number;
}

export interface EventSummary {
  id: string;
  issueId: number | null;
  timestamp: number;
  level: string;
  environment: string | null;
  release: string | null;
  message: string | null;
}

export interface EventDetail extends EventSummary {
  payload: SentryEvent;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface ProjectStat {
  id: number;
  name: string;
  openIssues: number;
  events24h: number;
}

export interface ReleaseStat {
  name: string;
  events: number;
  lastSeen: number;
}

export interface OverviewStats {
  openIssues: number;
  events24h: number;
  events7d: number;
  eventsPerDay: DayCount[];
  projects: ProjectStat[];
  // performance (Fase 4)
  transactions24h: number;
  txAvg24h: number;
  txP9524h: number;
  txErrorRate24h: number;
  topRoutes: TopRoute[];
}

export interface TopRoute {
  projectId: number;
  projectName: string;
  name: string;
  count: number;
  p95: number;
  errorRate: number;
  lastSeen: number;
}

// ------------------------------------------------------------------
// Performance / transactions (Fase 4)
// ------------------------------------------------------------------

export interface Transaction {
  id: string;
  projectId: number;
  name: string; // rota / transaction name
  timestamp: number; // início (ms)
  duration: number; // ms
  status: string; // ok | error | cancelled | aborted | unknown
  release: string | null;
  environment: string | null;
  platform: string | null;
  browser: string | null;
  country: string | null;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  measurements: Record<string, { value?: number; unit?: string }> | null;
}

export interface TransactionDetail extends Transaction {
  spans: Span[];
}

export interface Span {
  id: string;
  transactionId: string;
  traceId: string | null;
  parentSpanId: string | null;
  op: string | null;
  description: string | null;
  startTimestamp: number | null; // ms (absoluto, relativo ao epoch)
  endTimestamp: number | null;
  duration: number | null; // ms
  status: string | null;
}

export interface TransactionSummary {
  name: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  errorCount: number;
  errorRate: number; // 0..1
  firstSeen: number;
  lastSeen: number;
  throughput: number; // eventos/hora
}

export interface DayStat {
  date: string;
  count: number;
  avg: number;
}

export interface VitalsStat {
  p50: number | null;
  p75: number | null;
  p95: number | null;
  count: number;
}

export type VitalsMap = Partial<Record<"lcp" | "fcp" | "cls" | "ttfb" | "inp" | "fp", VitalsStat>>;

export interface ReleasePerformance {
  release: string | null;
  count: number;
  avg: number;
  p95: number;
  errorRate: number;
  lastSeen: number;
}

// ------------------------------------------------------------------
// Alertas (Fase 5)
// ------------------------------------------------------------------

export type AlertRuleType =
  | "new_issue"
  | "regression"
  | "frequency_spike"
  | "unresolved_age"
  | "rate_limit"
  | "daily_digest";

export type WebhookType = "generic" | "slack" | "discord";

export interface AlertRule {
  id: number;
  projectId: number;
  name: string;
  type: AlertRuleType;
  /** config específica por tipo (threshold, window_minutes, days…) */
  config: Record<string, unknown>;
  webhookType: WebhookType;
  webhookUrl: string;
  enabled: number; // 0 | 1
  lastFiredAt: number | null;
  createdAt: number;
}

export interface AlertLog {
  id: number;
  ruleId: number | null;
  projectId: number;
  issueId: number | null;
  type: string;
  title: string;
  sentAt: number;
  status: "ok" | "error";
  response: string | null;
}

// ------------------------------------------------------------------
// Releases & environments (Fase 3)
// ------------------------------------------------------------------

export interface ReleaseCommit {
  id: string;
  message: string;
  author: string | null;
  timestamp: number | null;
  url: string | null;
}

export interface Release {
  name: string;
  projectId: number;
  firstSeen: number; // primeiro evento/transação com essa release
  lastSeen: number;
  events: number;
  transactions: number;
  issues: number; // issues que tiveram eventos nessa release
  deployedAt: number | null; // metadata manual (webhook de deploy)
  commits: ReleaseCommit[];
}

export interface ReleaseDetail extends Release {
  newIssues: Issue[]; // issues introduzidas na release (primeiro evento com essa release)
  environments: Array<{ environment: string; events: number }>;
  txAvg: number;
  txP95: number;
  txErrorRate: number;
}

export interface ReleaseCompare {
  a: ReleaseCompareRow;
  b: ReleaseCompareRow;
}

export interface ReleaseCompareRow {
  name: string;
  events: number;
  newIssues: number;
  issuesTotal: number;
  txCount: number;
  txAvg: number;
  txP95: number;
  txErrorRate: number;
  firstSeen: number;
  lastSeen: number;
}

export interface EnvCount {
  name: string;
  count: number;
}
