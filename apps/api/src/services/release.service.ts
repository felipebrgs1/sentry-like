import { and, eq, isNotNull, sql } from "drizzle-orm";
import type {
  EnvCount,
  Issue,
  Release,
  ReleaseCommit,
  ReleaseCompare,
  ReleaseCompareRow,
  ReleaseDetail,
} from "@sentrylike/shared";
import { db } from "../db";
import { events, issues, releases, transactions } from "../db/schema";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function parseCommits(raw: string | null): ReleaseCommit[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Metadata manual de releases (webhook de deploy). */
async function releaseMeta(
  projectId: number,
): Promise<Map<string, { deployedAt: number | null; commits: ReleaseCommit[] }>> {
  const rows = await db.select().from(releases).where(eq(releases.projectId, projectId)).all();
  return new Map(
    rows.map((r) => [r.name, { deployedAt: r.deployedAt, commits: parseCommits(r.commits) }]),
  );
}

// ------------------------------------------------------------------
// listagens
// ------------------------------------------------------------------

/** Releases auto-descobertas (events + transactions) mescladas com metadata. */
export async function listReleases(projectId: number): Promise<Release[]> {
  const meta = await releaseMeta(projectId);

  const evRows = await db
    .select({
      name: events.release,
      first: sql<number>`min(${events.timestamp})`,
      last: sql<number>`max(${events.timestamp})`,
      count: sql<number>`count(*)`,
      issues: sql<number>`count(distinct ${events.issueId})`,
    })
    .from(events)
    .where(and(eq(events.projectId, projectId), isNotNull(events.release)))
    .groupBy(events.release)
    .all();

  const txRows = await db
    .select({
      name: transactions.release,
      first: sql<number>`min(${transactions.timestamp})`,
      last: sql<number>`max(${transactions.timestamp})`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(and(eq(transactions.projectId, projectId), isNotNull(transactions.release)))
    .groupBy(transactions.release)
    .all();

  const txByName = new Map(txRows.map((r) => [r.name, r]));
  const out: Release[] = [];
  for (const r of evRows) {
    if (!r.name) continue;
    const tx = txByName.get(r.name);
    const m = meta.get(r.name);
    out.push({
      name: r.name,
      projectId,
      firstSeen: Math.min(r.first, tx?.first ?? r.first),
      lastSeen: Math.max(r.last, tx?.last ?? r.last),
      events: r.count,
      transactions: tx?.count ?? 0,
      issues: r.issues,
      deployedAt: m?.deployedAt ?? null,
      commits: m?.commits ?? [],
    });
    txByName.delete(r.name);
  }
  // releases que só têm transactions (sem eventos)
  for (const [name, tx] of txByName) {
    if (!name) continue;
    const m = meta.get(name);
    out.push({
      name,
      projectId,
      firstSeen: tx.first,
      lastSeen: tx.last,
      events: 0,
      transactions: tx.count,
      issues: 0,
      deployedAt: m?.deployedAt ?? null,
      commits: m?.commits ?? [],
    });
  }

  return out.toSorted((a, b) => b.lastSeen - a.lastSeen);
}

/** Detalhe de uma release: stats, issues novas, distribuição de ambientes. */
export async function getReleaseDetail(
  projectId: number,
  name: string,
): Promise<ReleaseDetail | null> {
  const list = await listReleases(projectId);
  const base = list.find((r) => r.name === name);
  if (!base) return null;

  const envRows = await db
    .select({
      environment: events.environment,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(
      and(eq(events.projectId, projectId), eq(events.release, name), isNotNull(events.environment)),
    )
    .groupBy(events.environment)
    .all();

  // issues introduzidas: o primeiro evento da issue tem essa release
  const newRows = await db
    .select({ id: issues.id })
    .from(issues)
    .innerJoin(events, eq(events.issueId, issues.id))
    .where(
      and(
        eq(issues.projectId, projectId),
        eq(events.release, name),
        eq(events.timestamp, issues.firstSeen),
      ),
    )
    .groupBy(issues.id)
    .all();
  const newIssueIds = newRows.map((r) => r.id);

  const newIssues: Issue[] = [];
  for (const id of newIssueIds) {
    const row = await db.select().from(issues).where(eq(issues.id, id)).get();
    if (row) newIssues.push({ ...row, status: row.status as Issue["status"] });
  }

  // performance da release
  const txRows = await db
    .select({ duration: transactions.duration, status: transactions.status })
    .from(transactions)
    .where(and(eq(transactions.projectId, projectId), eq(transactions.release, name)))
    .all();
  const durations = txRows.map((r) => r.duration).toSorted((a, b) => a - b);
  const errors = txRows.filter((r) => r.status !== "ok").length;

  return {
    ...base,
    newIssues,
    environments: envRows
      .filter((r): r is { environment: string; count: number } => !!r.environment)
      .map((r) => ({ environment: r.environment, events: r.count }))
      .toSorted((a, b) => b.events - a.events),
    txAvg: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    txP95: percentile(durations, 95),
    txErrorRate: durations.length ? errors / durations.length : 0,
  };
}

/** Comparação lado a lado de duas releases. */
export async function compareReleases(
  projectId: number,
  a: string,
  b: string,
): Promise<ReleaseCompare | null> {
  const row = async (name: string): Promise<ReleaseCompareRow | null> => {
    const detail = await getReleaseDetail(projectId, name);
    if (!detail) return null;
    return {
      name,
      events: detail.events,
      newIssues: detail.newIssues.length,
      issuesTotal: detail.issues,
      txCount: detail.transactions,
      txAvg: detail.txAvg,
      txP95: detail.txP95,
      txErrorRate: detail.txErrorRate,
      firstSeen: detail.firstSeen,
      lastSeen: detail.lastSeen,
    };
  };
  const ra = await row(a);
  const rb = await row(b);
  if (!ra || !rb) return null;
  return { a: ra, b: rb };
}

/** Metadata manual: marca deploy e/ou grava commits de uma release. */
export async function markRelease(
  projectId: number,
  name: string,
  input: { commits?: ReleaseCommit[]; deployedAt?: number | null },
): Promise<void> {
  const existing = await db
    .select()
    .from(releases)
    .where(and(eq(releases.projectId, projectId), eq(releases.name, name)))
    .get();
  if (existing) {
    await db
      .update(releases)
      .set({
        commits: input.commits ? JSON.stringify(input.commits) : existing.commits,
        deployedAt: input.deployedAt !== undefined ? input.deployedAt : existing.deployedAt,
      })
      .where(eq(releases.id, existing.id))
      .run();
  } else {
    await db
      .insert(releases)
      .values({
        projectId,
        name,
        commits: JSON.stringify(input.commits ?? []),
        deployedAt: input.deployedAt ?? Date.now(),
        createdAt: Date.now(),
      })
      .run();
  }
}

// ------------------------------------------------------------------
// distribuição por issue (Fase 3)
// ------------------------------------------------------------------

export async function issueEnvironments(issueId: number): Promise<EnvCount[]> {
  const rows = await db
    .select({
      name: events.environment,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(and(eq(events.issueId, issueId), isNotNull(events.environment)))
    .groupBy(events.environment)
    .all();
  return rows
    .filter((r): r is { name: string; count: number } => !!r.name)
    .map((r) => ({ name: r.name, count: r.count }))
    .toSorted((a, b) => b.count - a.count);
}

export async function issueReleases(issueId: number): Promise<EnvCount[]> {
  const rows = await db
    .select({
      name: events.release,
      count: sql<number>`count(*)`,
    })
    .from(events)
    .where(and(eq(events.issueId, issueId), isNotNull(events.release)))
    .groupBy(events.release)
    .all();
  return rows
    .filter((r): r is { name: string; count: number } => !!r.name)
    .map((r) => ({ name: r.name, count: r.count }))
    .toSorted((a, b) => b.count - a.count);
}

// ------------------------------------------------------------------
// webhook de deploy (GitHub / GitLab push)
// ------------------------------------------------------------------

interface GitWebhook {
  project_id?: string;
  ref?: string; // "refs/heads/main" ou "refs/tags/v1.0.0"
  commits?: Array<{
    id?: string;
    message?: string;
    author?: { name?: string };
    timestamp?: string;
    url?: string;
  }>;
  head_commit?: { id?: string };
}

/**
 * Webhook genérico de deploy: GitHub (push) e GitLab (push) têm o mesmo formato
 * básico (ref + commits[]). Extrai a release do ref (tag) e grava commits + deploy.
 */
export async function handleDeployWebhook(
  projectId: number,
  payload: unknown,
): Promise<string | null> {
  const p = (payload ?? {}) as GitWebhook;
  const ref = p.ref ?? "";
  const name = ref.replace(/^refs\/(tags|heads)\//, "").trim();
  if (!name) return null;

  const commits: ReleaseCommit[] = (p.commits ?? []).slice(0, 50).map((c) => ({
    id: c.id ?? "",
    message: (c.message ?? "").split("\n")[0].slice(0, 200),
    author: c.author?.name ?? null,
    timestamp: c.timestamp ? new Date(c.timestamp).getTime() || null : null,
    url: c.url ?? null,
  }));

  await markRelease(projectId, name, { commits, deployedAt: Date.now() });
  return name;
}
