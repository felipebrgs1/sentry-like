/**
 * Reset de senha via CLI (VPS — quem tem acesso ao servidor/banco é o dono).
 * Uso: DATABASE_PATH=/data/sentrylike.db bun scripts/reset-password.ts <email> <nova-senha>
 * Depois rode a API e troque/remova conforme necessário.
 */
import { initBunDb } from "../apps/api/src/db";
import { users } from "../apps/api/src/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../apps/api/src/lib/password";
import { db } from "../apps/api/src/db";

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password || password.length < 6) {
  console.error("uso: bun scripts/reset-password.ts <email> <nova-senha-min-6>");
  process.exit(1);
}

await initBunDb();
const user = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
if (!user) {
  console.error(`usuário não encontrado: ${email}`);
  process.exit(1);
}
await db
  .update(users)
  .set({ passwordHash: await hashPassword(password) })
  .where(eq(users.id, user.id))
  .run();
console.log(`senha do usuário ${email} redefinida.`);
