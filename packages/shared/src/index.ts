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
  fingerprint?: string[]; // fingerprint custom enviado pelo SDK
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
}
