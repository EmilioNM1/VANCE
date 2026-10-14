import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, withUser } from "@/db/client";
import { attempts, claims, conceptMastery, concepts, documents, evaluations, libraries, reviewLogs, users } from "@/db/schema";
import { resolveSettings } from "@/lib/types";
import { verifyPassword } from "./auth/password";
import { AuthError } from "./auth/service";
import { deleteUserFiles } from "./documents/storage";

export const settingsSchema = z.object({
  initialIntervalsDays: z
    .object({
      again: z.number().min(0.003).max(1),
      hard: z.number().min(0.1).max(10),
      good: z.number().min(0.5).max(30),
      easy: z.number().min(1).max(60),
    })
    .optional(),
  desiredRetention: z.number().min(0.7).max(0.97).optional(),
  maxHintLevel: z.number().int().min(1).max(4).optional(),
  retriesBeforeExplanation: z.number().int().min(0).max(4).optional(),
  dailyNewConcepts: z.number().int().min(0).max(100).optional(),
  dailyReviewGoal: z.number().int().min(1).max(500).optional(),
  weeklyMinutesGoal: z.number().int().min(10).max(5000).optional(),
});

export async function getProfile(userId: string) {
  const [u] = await getDb().select({ id: users.id, email: users.email, name: users.name, settings: users.settings, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  if (!u) throw new Error("Usuario no encontrado");
  return { ...u, settings: resolveSettings(u.settings) };
}

export async function updateProfile(userId: string, input: unknown) {
  const data = z.object({ name: z.string().trim().min(1).max(100) }).parse(input);
  await getDb().update(users).set({ name: data.name, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function updateSettings(userId: string, input: unknown) {
  const patch = settingsSchema.parse(input);
  const current = (await getProfile(userId)).settings;
  const next = { ...current, ...patch, initialIntervalsDays: { ...current.initialIntervalsDays, ...(patch.initialIntervalsDays ?? {}) } };
  const iv = next.initialIntervalsDays;
  if (!(iv.again <= iv.hard && iv.hard <= iv.good && iv.good <= iv.easy)) throw new AuthError("Los intervalos iniciales deben ser crecientes (olvidado ≤ difícil ≤ bien ≤ fácil).", "INVALID_INPUT");
  await getDb().update(users).set({ settings: next, updatedAt: new Date() }).where(eq(users.id, userId));
  return next;
}

/** Elimina definitivamente la cuenta, sus archivos y todos los datos derivados (cascada). */
export async function deleteAccount(userId: string, password: string) {
  const [u] = await getDb().select().from(users).where(eq(users.id, userId));
  if (!u || !(await verifyPassword(password, u.passwordHash))) throw new AuthError("La contraseña no es correcta", "INVALID_CREDENTIALS");
  await getDb().delete(users).where(eq(users.id, userId));
  await deleteUserFiles(userId);
}

/** Exportación de los datos personales (portabilidad). No incluye los archivos originales. */
export async function exportUserData(userId: string) {
  const profile = await getProfile(userId);
  const data = await withUser(userId, async (tx) => ({
    libraries: await tx.select().from(libraries),
    documents: (await tx.select().from(documents)).map((d) => ({ ...d, storageKey: undefined })),
    claims: await tx.select().from(claims),
    concepts: await tx.select().from(concepts),
    mastery: await tx.select().from(conceptMastery),
    attempts: await tx.select().from(attempts),
    evaluations: await tx.select().from(evaluations),
    reviewLogs: await tx.select().from(reviewLogs),
  }));
  return { exportedAt: new Date().toISOString(), profile, ...data };
}
