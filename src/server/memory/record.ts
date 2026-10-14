import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { conceptConfusions, conceptErrors, conceptMastery, reviewLogs, users, type ActivityType } from "@/db/schema";
import { resolveSettings } from "@/lib/types";
import { deriveState, emptyDimensions, illusionOfCompetence, updateDimensions } from "./mastery";
import { countsForSchedule, DAY, gradeFromOutcome, schedule, updateCalibration } from "./scheduler";

export interface Outcome {
  conceptId: string;
  attemptId: string | null;
  activityType: ActivityType;
  firstScore: number;
  finalScore: number;
  hintsUsed: number;
  explanationShown: boolean;
  confidence: number | null;
  criticalErrors: { tag: string; description: string }[];
  confusedWithConceptIds: string[];
  provisional: boolean;
  ambiguous: boolean;
}

/**
 * Registra el resultado de una actividad terminada: errores, confusiones, perfil de dominio,
 * programación del siguiente repaso y calibración personal. Debe ejecutarse dentro de withUser.
 */
export async function recordOutcome(tx: Tx, userId: string, o: Outcome, now = new Date()) {
  const [u] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  const settings = resolveSettings(u?.settings);
  const [m] = await tx.select().from(conceptMastery).where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, o.conceptId)));
  const prev = m ?? {
    state: "NEW" as const,
    dimensions: emptyDimensions(),
    stability: 0,
    difficulty: 5,
    reps: 0,
    lapses: 0,
    independentSuccessDays: [] as string[],
    lastReviewedAt: null as Date | null,
    dueAt: null as Date | null,
  };

  // Errores conceptuales (recurrencia)
  let recurringError = false;
  for (const e of o.criticalErrors) {
    const [row] = await tx
      .insert(conceptErrors)
      .values({ userId, conceptId: o.conceptId, tag: e.tag.slice(0, 80), description: e.description.slice(0, 500) })
      .onConflictDoUpdate({
        target: [conceptErrors.userId, conceptErrors.conceptId, conceptErrors.tag],
        set: { count: sql`${conceptErrors.count} + 1`, lastSeenAt: now, resolved: false, description: e.description.slice(0, 500) },
      })
      .returning({ count: conceptErrors.count });
    if ((row?.count ?? 1) >= 2) recurringError = true;
  }
  const independentSuccess = o.hintsUsed === 0 && o.firstScore >= 0.75 && !o.provisional && o.activityType !== "RECOGNITION";
  if (independentSuccess && !o.criticalErrors.length) {
    await tx.update(conceptErrors).set({ resolved: true }).where(and(eq(conceptErrors.userId, userId), eq(conceptErrors.conceptId, o.conceptId)));
  }
  for (const other of o.confusedWithConceptIds) {
    if (other === o.conceptId) continue;
    await tx
      .insert(conceptConfusions)
      .values({ userId, conceptId: o.conceptId, confusedWithId: other })
      .onConflictDoUpdate({
        target: [conceptConfusions.userId, conceptConfusions.conceptId, conceptConfusions.confusedWithId],
        set: { count: sql`${conceptConfusions.count} + 1`, lastSeenAt: now },
      });
  }

  const grade = gradeFromOutcome({
    activityType: o.activityType,
    firstScore: o.firstScore,
    finalScore: o.finalScore,
    hintsUsed: o.hintsUsed,
    explanationShown: o.explanationShown,
    confidence: o.confidence,
    recurringError,
    ambiguous: o.ambiguous,
  });
  const memState = { stability: prev.stability, difficulty: prev.difficulty, reps: prev.reps, lapses: prev.lapses, lastReviewedAt: prev.lastReviewedAt };
  const elapsedDays = prev.lastReviewedAt ? (now.getTime() - prev.lastReviewedAt.getTime()) / DAY : 0;
  const counts = countsForSchedule(o.activityType);
  let next = memState;
  let dueAt = prev.dueAt;
  let scheduledDays = 0;
  let predicted: number | null = null;
  if (counts) {
    const s = schedule(memState, grade, now, settings);
    next = s.state;
    dueAt = s.dueAt;
    scheduledDays = s.intervalDays;
    predicted = s.predictedRecall;
    if (predicted !== null && !o.provisional) {
      const calibration = updateCalibration(settings.calibration, predicted, grade >= 3);
      await tx.update(users).set({ settings: { ...settings, calibration } }).where(eq(users.id, userId));
    }
  } else if (prev.state === "NEW" || !dueAt) {
    // Reconocer no basta: se programa una recuperación libre inmediata
    dueAt = now;
  }

  const dims = updateDimensions(prev.dimensions ?? emptyDimensions(), {
    activityType: o.activityType,
    firstScore: o.firstScore,
    finalScore: o.finalScore,
    hintsUsed: o.hintsUsed,
    elapsedDays,
    criticalErrorCount: o.criticalErrors.length,
    confusedWithOther: o.confusedWithConceptIds.length > 0,
    hadErrorsThenCorrected: o.firstScore < 0.85 ? o.finalScore >= 0.85 : null,
    provisional: o.provisional,
  });
  const today = now.toISOString().slice(0, 10);
  const days = independentSuccess ? [...new Set([...prev.independentSuccessDays, today])].slice(-10) : prev.independentSuccessDays;
  const [{ unresolved } = { unresolved: 0 }] = await tx
    .select({ unresolved: sql<number>`count(*)::int` })
    .from(conceptErrors)
    .where(and(eq(conceptErrors.userId, userId), eq(conceptErrors.conceptId, o.conceptId), eq(conceptErrors.resolved, false), sql`${conceptErrors.count} >= 2`));
  const state = deriveState({
    dims,
    stability: next.stability,
    reps: next.reps,
    lastGrade: counts ? grade : null,
    previous: prev.state,
    independentSuccessDays: days,
    unresolvedRecurringErrors: unresolved,
  });

  const values = {
    userId,
    conceptId: o.conceptId,
    state,
    dimensions: dims,
    stability: next.stability,
    difficulty: next.difficulty,
    reps: next.reps,
    lapses: next.lapses,
    independentSuccessDays: days,
    lastReviewedAt: counts ? now : prev.lastReviewedAt,
    dueAt,
    illusionFlag: illusionOfCompetence(dims),
    updatedAt: now,
  };
  await tx.insert(conceptMastery).values(values).onConflictDoUpdate({ target: [conceptMastery.userId, conceptMastery.conceptId], set: values });
  await tx.insert(reviewLogs).values({
    userId,
    conceptId: o.conceptId,
    attemptId: o.attemptId,
    activityType: o.activityType,
    grade,
    score: o.firstScore,
    hintsUsed: o.hintsUsed,
    elapsedDays,
    predictedRecall: predicted,
    stabilityBefore: prev.stability,
    stabilityAfter: next.stability,
    scheduledDays,
    countsForSchedule: counts,
    createdAt: now,
  });
  return { grade, state, dueAt, scheduledDays, recurringError };
}
