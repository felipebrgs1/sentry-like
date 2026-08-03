import { and, eq, isNull, sql } from "drizzle-orm";
import type { ApiToken, Org, User } from "@sentrylike/shared";
import { db } from "../db";
import { apiTokens, orgMembers, orgs, projects, sessions, users } from "../db/schema";

import { hashPassword, verifyPassword } from "../lib/password";
import { verifyTotp } from "../lib/totp";

// ------------------------------------------------------------------
// bootstrap (primeiro boot): owner + org default + projetos na org
// ------------------------------------------------------------------

let bootstrapDone = false;

export async function ensureBootstrap(): Promise<void> {
  if (bootstrapDone) return;
  bootstrapDone = true;

  // org default (idempotente) — usuário fica para o onboarding ou env
  const orgCount = await db
    .select({ c: sql<number>`count(*)` })
    .from(orgs)
    .get();
  if ((orgCount?.c ?? 0) === 0) {
    await db.insert(orgs).values({ name: "Default", slug: "default", createdAt: Date.now() }).run();
  }

  // backfill: projetos existentes passam para a org default
  const orgId = await defaultOrgId();
  if (orgId) await db.update(projects).set({ orgId }).where(isNull(projects.orgId)).run();

  // backfill automático (docker/CI): se ADMIN_USER + ADMIN_PASSWORD estiverem definidos
  // e não houver usuário, cria o owner a partir deles (senão, onboarding no front).
  const userCount = await db
    .select({ c: sql<number>`count(*)` })
    .from(users)
    .get();
  if (
    (userCount?.c ?? 0) === 0 &&
    process.env.ADMIN_USER?.trim() &&
    process.env.ADMIN_PASSWORD?.trim()
  ) {
    await createOwner(process.env.ADMIN_USER.trim(), process.env.ADMIN_PASSWORD.trim());
  }

  // reset de senha via env (sem email) — ver applyResetPassword()
  if (await applyResetPassword()) {
    console.error(
      "[sentrylike] RESET_PASSWORD aplicada ao owner — faça login com a temporária, troque no dashboard e delete o secret.",
    );
  }
}

async function createOwner(username: string, password: string): Promise<void> {
  const email = username.includes("@") ? username : `${username}@localhost`;
  const row = await db
    .insert(users)
    .values({
      email,
      name: username,
      passwordHash: await hashPassword(password),
      isOwner: 1,
      createdAt: Date.now(),
    })
    .returning({ id: users.id })
    .get();
  const orgId = await defaultOrgId();
  if (orgId) {
    await db
      .insert(orgMembers)
      .values({ orgId, userId: row.id, role: "owner", createdAt: Date.now() })
      .run();
  }
}

/** Existe pelo menos um usuário? (front usa para onboarding vs login) */
export async function needsSetup(): Promise<boolean> {
  const count = await db
    .select({ c: sql<number>`count(*)` })
    .from(users)
    .get();
  return (count?.c ?? 0) === 0;
}

/**
 * Reset de senha por env (sem email): se RESET_PASSWORD estiver definido no
 * ambiente, a senha do owner é sobrescrita no boot. NADA é exibido em log —
 * quem tem acesso ao env/deploy é quem tem posse da conta (prova de posse).
 * Após logar com a temporária, troque no front e delete o secret.
 */
export async function applyResetPassword(): Promise<boolean> {
  const temp = process.env.RESET_PASSWORD?.trim();
  if (!temp) return false;
  const owner = await db
    .select()
    .from(users)
    .where(eq(users.isOwner, 1))
    .orderBy(users.createdAt)
    .limit(1)
    .get();
  if (!owner) return false;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(temp) })
    .where(eq(users.id, owner.id))
    .run();
  return true;
}

/** Troca a senha do usuário logado (exige a senha atual). */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return false;
  if (!(await verifyPassword(currentPassword, user.passwordHash))) return false;
  if (newPassword.length < 6) return false;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId))
    .run();
  return true;
}

/** Onboarding: cria o primeiro usuário (owner). Só funciona com zero usuários. */
export async function setupOwner(input: {
  name: string;
  email: string;
  password: string;
}): Promise<DbUser | null> {
  if (!(await needsSetup())) return null;
  const email = input.email.trim().toLowerCase();
  const row = await db
    .insert(users)
    .values({
      email,
      name: input.name.trim().slice(0, 80),
      passwordHash: await hashPassword(input.password),
      isOwner: 1,
      createdAt: Date.now(),
    })
    .returning({ id: users.id })
    .get();
  const orgId = await defaultOrgId();
  if (orgId) {
    await db
      .insert(orgMembers)
      .values({ orgId, userId: row.id, role: "owner", createdAt: Date.now() })
      .run();
  }
  return (await getUserById(row.id))!;
}

// ------------------------------------------------------------------
// autenticação
// ------------------------------------------------------------------

export async function loginUser(
  email: string,
  password: string,
  totpCode?: string,
): Promise<DbUser | null> {
  const input = email.trim().toLowerCase();
  let user = await db.select().from(users).where(eq(users.email, input)).get();
  if (!user && !input.includes("@")) {
    // bootstrap: owner criado como <user>@localhost — aceita o username sem domínio
    user = await db
      .select()
      .from(users)
      .where(eq(users.email, `${input}@localhost`))
      .get();
  }
  if (!user) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  if (user.totpEnabled) {
    if (!user.totpSecret || !totpCode || !(await verifyTotp(user.totpSecret, totpCode))) {
      return null;
    }
  }
  return user;
}

export type DbUser = typeof users.$inferSelect;

export async function getUserById(id: number): Promise<DbUser | undefined> {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export async function getUserByEmail(email: string): Promise<DbUser | undefined> {
  return db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
}

/** Resolve o usuário por sessão OU por API token (Bearer). */
export async function authenticate(token: string | null): Promise<DbUser | null> {
  if (!token) return null;
  const session = await db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (session && session.expiresAt > Date.now() && session.userId) {
    return (await getUserById(session.userId)) ?? null;
  }
  const apiToken = await db.select().from(apiTokens).where(eq(apiTokens.token, token)).get();
  if (apiToken) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: Date.now() })
      .where(eq(apiTokens.id, apiToken.id))
      .run();
    return (await getUserById(apiToken.userId)) ?? null;
  }
  return null;
}

export function toPublicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, isOwner: u.isOwner, totpEnabled: u.totpEnabled };
}

// ------------------------------------------------------------------
// gestão de usuários (owner)
// ------------------------------------------------------------------

export async function listUsers(): Promise<DbUser[]> {
  return db.select().from(users).orderBy(users.createdAt).all();
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  isOwner?: number;
}): Promise<DbUser> {
  const orgId = await defaultOrgId();
  const row = await db
    .insert(users)
    .values({
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      isOwner: input.isOwner ?? 0,
      createdAt: Date.now(),
    })
    .returning({ id: users.id })
    .get();
  if (orgId) {
    await db
      .insert(orgMembers)
      .values({
        orgId,
        userId: row.id,
        role: input.isOwner ? "owner" : "member",
        createdAt: Date.now(),
      })
      .run();
  }
  return (await getUserById(row.id))!;
}

export async function deleteUser(id: number): Promise<boolean> {
  const user = await getUserById(id);
  if (!user) return false;
  if (user.isOwner) return false; // não deleta o último owner
  await db.delete(orgMembers).where(eq(orgMembers.userId, id)).run();
  await db.delete(apiTokens).where(eq(apiTokens.userId, id)).run();
  await db.delete(sessions).where(eq(sessions.userId, id)).run();
  await db.delete(users).where(eq(users.id, id)).run();
  return true;
}

// ------------------------------------------------------------------
// organizações
// ------------------------------------------------------------------

export async function defaultOrgId(): Promise<number | null> {
  const org = await db.select().from(orgs).orderBy(orgs.createdAt).limit(1).get();
  return org?.id ?? null;
}

export async function listUserOrgs(userId: number): Promise<Org[]> {
  const rows = await db
    .select({ org: orgs })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, userId))
    .all();
  return rows.map((r) => r.org);
}

/** O usuário tem acesso ao projeto (mesma org)? Owner vê tudo. */
export async function hasOrgAccess(user: User, projectOrgId: number | null): Promise<boolean> {
  if (user.isOwner) return true;
  if (projectOrgId == null) return false;
  const row = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, user.id), eq(orgMembers.orgId, projectOrgId)))
    .get();
  return !!row;
}

// ------------------------------------------------------------------
// API tokens
// ------------------------------------------------------------------

export async function listTokens(userId: number): Promise<ApiToken[]> {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(apiTokens.createdAt)
    .all();
}

export async function createToken(
  userId: number,
  name: string,
): Promise<{ id: number; name: string; token: string }> {
  const token = `sentrylike_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const row = await db
    .insert(apiTokens)
    .values({ userId, name: name.trim().slice(0, 80), token, createdAt: Date.now() })
    .returning({ id: apiTokens.id })
    .get();
  return { id: row.id, name: name.trim().slice(0, 80), token };
}

export async function deleteToken(id: number, userId: number): Promise<boolean> {
  const existing = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .get();
  if (!existing) return false;
  await db.delete(apiTokens).where(eq(apiTokens.id, id)).run();
  return true;
}

// ------------------------------------------------------------------
// 2FA (TOTP)
// ------------------------------------------------------------------

export async function enableTotp(userId: number, secret: string) {
  await db
    .update(users)
    .set({ totpSecret: secret, totpEnabled: 0 })
    .where(eq(users.id, userId))
    .run();
}

export async function confirmTotp(userId: number, code: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user?.totpSecret) return false;
  if (!(await verifyTotp(user.totpSecret, code))) return false;
  await db.update(users).set({ totpEnabled: 1 }).where(eq(users.id, userId)).run();
  return true;
}

export async function disableTotp(userId: number, code: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user?.totpSecret) return false;
  if (!(await verifyTotp(user.totpSecret, code))) return false;
  await db
    .update(users)
    .set({ totpSecret: null, totpEnabled: 0 })
    .where(eq(users.id, userId))
    .run();
  return true;
}
