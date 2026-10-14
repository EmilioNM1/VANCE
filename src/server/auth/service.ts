import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { authSessions, passwordResetTokens, users } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { hashPassword, randomToken, sha256, verifyPassword } from "./password";
import { registerSchema, loginSchema, passwordSchema } from "./validation";
import { sendMail } from "../mail";

export const SESSION_TTL_DAYS = 30;

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "INVALID_INPUT" | "EMAIL_TAKEN" | "INVALID_CREDENTIALS" | "INVALID_TOKEN" | "RATE_LIMITED",
  ) {
    super(message);
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export async function registerUser(input: unknown): Promise<PublicUser> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new AuthError(parsed.error.issues[0]?.message ?? "Datos no válidos", "INVALID_INPUT");
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email));
  if (existing.length) throw new AuthError("Ya existe una cuenta con ese correo", "EMAIL_TAKEN");
  const [u] = await db
    .insert(users)
    .values({
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      settings: DEFAULT_SETTINGS,
    })
    .returning({ id: users.id, email: users.email, name: users.name });
  return u!;
}

// Hash ficticio para igualar tiempos cuando el usuario no existe (evita enumeración por tiempo).
let dummyHash: string | null = null;

export async function authenticate(input: unknown): Promise<PublicUser> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new AuthError("Correo o contraseña incorrectos", "INVALID_CREDENTIALS");
  const [u] = await getDb().select().from(users).where(eq(users.email, parsed.data.email));
  if (!u) {
    dummyHash ??= await hashPassword("dummy-password-for-timing");
    await verifyPassword(parsed.data.password, dummyHash);
    throw new AuthError("Correo o contraseña incorrectos", "INVALID_CREDENTIALS");
  }
  if (!(await verifyPassword(parsed.data.password, u.passwordHash)))
    throw new AuthError("Correo o contraseña incorrectos", "INVALID_CREDENTIALS");
  return { id: u.id, email: u.email, name: u.name };
}

export async function createSession(userId: string, userAgent?: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await getDb()
    .insert(authSessions)
    .values({ userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export async function getUserBySessionToken(token: string | undefined | null): Promise<PublicUser | null> {
  if (!token || token.length > 200) return null;
  const rows = await getDb()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, sha256(token)), gt(authSessions.expiresAt, new Date())));
  return rows[0] ?? null;
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  await getDb().delete(authSessions).where(eq(authSessions.tokenHash, sha256(token)));
}

/**
 * Inicia la recuperación de contraseña. Siempre responde igual exista o no la cuenta.
 * Devuelve el enlace solo para pruebas internas; nunca se envía al cliente.
 */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u) return null;
  const token = randomToken();
  await db.insert(passwordResetTokens).values({
    userId: u.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await sendMail({
    to: u.email,
    subject: "Restablece tu contraseña de VANCE",
    text: `Hola ${u.name}:\n\nPara crear una nueva contraseña abre este enlace (válido 1 hora):\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
  });
  return link;
}

export async function resetPassword(token: string, newPassword: string) {
  const pw = passwordSchema.safeParse(newPassword);
  if (!pw.success) throw new AuthError(pw.error.issues[0]!.message, "INVALID_INPUT");
  const db = getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, sha256(token)),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    if (!row) throw new AuthError("El enlace no es válido o ha caducado", "INVALID_TOKEN");
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(pw.data), updatedAt: new Date() })
      .where(eq(users.id, row.userId));
    // Cierra todas las sesiones abiertas tras un cambio de contraseña.
    await tx.delete(authSessions).where(eq(authSessions.userId, row.userId));
  });
}

export async function changePassword(userId: string, current: string, next: string) {
  const [u] = await getDb().select().from(users).where(eq(users.id, userId));
  if (!u || !(await verifyPassword(current, u.passwordHash)))
    throw new AuthError("La contraseña actual no es correcta", "INVALID_CREDENTIALS");
  const pw = passwordSchema.safeParse(next);
  if (!pw.success) throw new AuthError(pw.error.issues[0]!.message, "INVALID_INPUT");
  await getDb().update(users).set({ passwordHash: await hashPassword(pw.data), updatedAt: new Date() }).where(eq(users.id, userId));
}
