import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withUser } from "@/db/client";
import {
  activities,
  attempts,
  conceptConfusions,
  conceptErrors,
  conceptMastery,
  concepts,
  documents,
  evaluations,
  libraries,
  notebookPages,
  notebooks,
  reviewLogs,
  sessionItems,
  users,
} from "@/db/schema";
import { resolveSettings, type MasteryDimensions } from "@/lib/types";
import { masteryIndex } from "../memory/mastery";
import { calibrationFactor } from "../memory/scheduler";
import { studiableConcept } from "../study/eligible";

const DAY = 86400_000;

/** Estadísticas del panel. Todo procede de actividades reales del usuario (rendimiento observado). */
export async function getDashboardStats(userId: string, now = new Date()) {
  return withUser(userId, async (tx) => {
    const [u] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
    const settings = resolveSettings(u?.settings);

    const conceptRows = await tx
      .select({
        id: concepts.id,
        name: concepts.name,
        documentId: concepts.documentId,
        pageId: concepts.pageId,
        documentTitle: documents.title,
        libraryName: libraries.name,
        libraryId: libraries.id,
        pageTitle: notebookPages.title,
        notebookTitle: notebooks.title,
        state: conceptMastery.state,
        dueAt: conceptMastery.dueAt,
        dims: conceptMastery.dimensions,
        illusion: conceptMastery.illusionFlag,
        stability: conceptMastery.stability,
      })
      .from(concepts)
      .leftJoin(documents, eq(documents.id, concepts.documentId))
      .leftJoin(libraries, eq(libraries.id, documents.libraryId))
      .leftJoin(notebookPages, eq(notebookPages.id, concepts.pageId))
      .leftJoin(notebooks, eq(notebooks.id, notebookPages.notebookId))
      .leftJoin(conceptMastery, and(eq(conceptMastery.conceptId, concepts.id), eq(conceptMastery.userId, userId)))
      .where(and(eq(concepts.userId, userId), studiableConcept));

    const byState = { NEW: 0, LEARNING: 0, CONSOLIDATING: 0, MASTERED: 0, RELEARNING: 0 };
    /** Progreso agrupado por fuente: cada libro y cada página de apuntes. */
    const byDoc = new Map<string, { documentId: string; kind: "DOCUMENT" | "NOTE"; href: string; title: string; library: string; total: number; states: typeof byState }>();
    for (const c of conceptRows) {
      const st = c.state ?? "NEW";
      byState[st]++;
      const key = (c.documentId ?? c.pageId)!;
      const d =
        byDoc.get(key) ??
        (c.documentId
          ? { documentId: key, kind: "DOCUMENT" as const, href: `/app/documents/${key}/concepts`, title: c.documentTitle ?? "Documento", library: c.libraryName ?? "", total: 0, states: { NEW: 0, LEARNING: 0, CONSOLIDATING: 0, MASTERED: 0, RELEARNING: 0 } }
          : { documentId: key, kind: "NOTE" as const, href: `/app/notebooks/page/${key}`, title: c.pageTitle ?? "Apuntes", library: `Cuaderno · ${c.notebookTitle ?? ""}`, total: 0, states: { NEW: 0, LEARNING: 0, CONSOLIDATING: 0, MASTERED: 0, RELEARNING: 0 } });
      d.total++;
      d.states[st]++;
      byDoc.set(key, d);
    }
    const dueNow = conceptRows.filter((c) => c.dueAt && c.dueAt <= now).length;
    const upcoming = Array.from({ length: 7 }, (_, i) => {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const from = new Date(start.getTime() + i * DAY);
      const to = new Date(from.getTime() + DAY);
      return { date: from.toISOString().slice(0, 10), count: conceptRows.filter((c) => c.dueAt && (i === 0 ? c.dueAt < to : c.dueAt >= from && c.dueAt < to)).length };
    });
    const illusions = conceptRows.filter((c) => c.illusion).map((c) => ({ id: c.id, name: c.name, documentTitle: c.documentTitle ?? c.pageTitle ?? "" }));

    const errors = await tx
      .select({ conceptId: conceptErrors.conceptId, conceptName: concepts.name, description: conceptErrors.description, count: conceptErrors.count, resolved: conceptErrors.resolved, lastSeenAt: conceptErrors.lastSeenAt })
      .from(conceptErrors)
      .innerJoin(concepts, eq(concepts.id, conceptErrors.conceptId))
      .where(eq(conceptErrors.userId, userId))
      .orderBy(desc(conceptErrors.count), desc(conceptErrors.lastSeenAt))
      .limit(10);

    const confusionRows = await tx
      .select({ a: conceptConfusions.conceptId, b: conceptConfusions.confusedWithId, count: conceptConfusions.count })
      .from(conceptConfusions)
      .where(eq(conceptConfusions.userId, userId))
      .orderBy(desc(conceptConfusions.count))
      .limit(10);
    const nameOf = new Map(conceptRows.map((c) => [c.id, c.name]));
    const confusions = confusionRows.map((r) => ({ a: nameOf.get(r.a) ?? "?", b: nameOf.get(r.b) ?? "?", aId: r.a, count: r.count }));

    const history = await tx
      .select({
        id: attempts.id,
        createdAt: attempts.createdAt,
        phase: attempts.phase,
        hintLevel: attempts.hintLevelAtSubmit,
        type: activities.type,
        conceptName: concepts.name,
        conceptId: concepts.id,
        score: evaluations.score,
        provisional: evaluations.provisional,
      })
      .from(attempts)
      .innerJoin(activities, eq(activities.id, attempts.activityId))
      .innerJoin(concepts, eq(concepts.id, attempts.conceptId))
      .innerJoin(evaluations, eq(evaluations.attemptId, attempts.id))
      .where(eq(attempts.userId, userId))
      .orderBy(desc(attempts.createdAt))
      .limit(25);

    const logs = await tx.select().from(reviewLogs).where(eq(reviewLogs.userId, userId)).orderBy(desc(reviewLogs.createdAt)).limit(2000);
    const bucket = (lo: number, hi: number) => {
      const l = logs.filter((r) => r.countsForSchedule && r.elapsedDays >= lo && r.elapsedDays < hi);
      return {
        n: l.length,
        avgScore: l.length ? l.reduce((a, r) => a + r.score, 0) / l.length : null,
        successRate: l.length ? l.filter((r) => r.grade >= 3).length / l.length : null,
      };
    };
    const retention = {
      immediate: bucket(0, 1),
      days1to7: bucket(1, 7),
      days7to30: bucket(7, 30),
      days30plus: bucket(30, Infinity),
    };
    const freeRecallLogs = logs.filter((r) => r.activityType === "FREE_RECALL" || r.activityType === "EXPLAIN");
    const weekly = Array.from({ length: 8 }, (_, i) => {
      const to = new Date(now.getTime() - i * 7 * DAY);
      const from = new Date(to.getTime() - 7 * DAY);
      const l = logs.filter((r) => r.createdAt >= from && r.createdAt < to && r.countsForSchedule);
      return {
        weekStart: from.toISOString().slice(0, 10),
        n: l.length,
        avgScore: l.length ? l.reduce((a, r) => a + r.score, 0) / l.length : null,
        independent: l.length ? l.filter((r) => r.hintsUsed === 0).length / l.length : null,
      };
    }).reverse();

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const timeRows = await tx
      .select({ presentedAt: sessionItems.presentedAt, completedAt: sessionItems.completedAt })
      .from(sessionItems)
      .where(and(eq(sessionItems.userId, userId), gte(sessionItems.completedAt, weekAgo)));
    const minutes = (from: Date) =>
      Math.round(
        timeRows
          .filter((r) => r.presentedAt && r.completedAt && r.completedAt >= from)
          .reduce((a, r) => a + Math.min(15 * 60_000, r.completedAt!.getTime() - r.presentedAt!.getTime()), 0) / 60_000,
      );
    const [{ itemsToday } = { itemsToday: 0 }] = await tx
      .select({ itemsToday: sql<number>`count(*)::int` })
      .from(sessionItems)
      .where(and(eq(sessionItems.userId, userId), eq(sessionItems.state, "DONE"), gte(sessionItems.completedAt, startOfDay)));
    const [hintAgg] = await tx
      .select({ attempts: sql<number>`count(*)::int`, withHints: sql<number>`count(*) filter (where ${attempts.hintLevelAtSubmit} > 0)::int` })
      .from(attempts)
      .where(eq(attempts.userId, userId));

    return {
      byState,
      totalConcepts: conceptRows.length,
      dueNow,
      upcoming,
      documents: [...byDoc.values()],
      illusions,
      errors,
      confusions,
      history,
      retention,
      weekly,
      freeRecall: {
        n: freeRecallLogs.length,
        avgScore: freeRecallLogs.length ? freeRecallLogs.reduce((a, r) => a + r.score, 0) / freeRecallLogs.length : null,
      },
      hints: { attempts: hintAgg?.attempts ?? 0, withHints: hintAgg?.withHints ?? 0 },
      time: { todayMinutes: minutes(startOfDay), weekMinutes: minutes(weekAgo) },
      goals: { dailyReviewGoal: settings.dailyReviewGoal, itemsToday, weeklyMinutesGoal: settings.weeklyMinutesGoal },
      calibration: { ...settings.calibration, factor: calibrationFactor(settings.calibration) },
    };
  });
}

export async function getConceptProgress(userId: string, conceptId: string) {
  return withUser(userId, async (tx) => {
    const [m] = await tx.select().from(conceptMastery).where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, conceptId)));
    const errs = await tx.select().from(conceptErrors).where(and(eq(conceptErrors.userId, userId), eq(conceptErrors.conceptId, conceptId))).orderBy(desc(conceptErrors.count));
    const logs = await tx.select().from(reviewLogs).where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.conceptId, conceptId))).orderBy(desc(reviewLogs.createdAt)).limit(50);
    const acts = await tx.select({ id: activities.id, type: activities.type, prompt: activities.prompt, generatedBy: activities.generatedBy }).from(activities).where(eq(activities.conceptId, conceptId));
    return {
      mastery: m ?? null,
      index: m ? masteryIndex(m.dimensions as MasteryDimensions, m.state) : null,
      errors: errs,
      logs,
      activities: acts,
    };
  });
}

export async function getAgenda(userId: string, now = new Date()) {
  return withUser(userId, (tx) =>
    tx
      .select({
        conceptId: concepts.id,
        name: concepts.name,
        documentTitle: sql<string>`coalesce(${documents.title}, 'Apuntes · ' || ${notebookPages.title})`,
        documentId: concepts.documentId,
        pageId: concepts.pageId,
        state: conceptMastery.state,
        dueAt: conceptMastery.dueAt,
        stability: conceptMastery.stability,
        lastReviewedAt: conceptMastery.lastReviewedAt,
        illusion: conceptMastery.illusionFlag,
      })
      .from(conceptMastery)
      .innerJoin(concepts, eq(concepts.id, conceptMastery.conceptId))
      .leftJoin(documents, eq(documents.id, concepts.documentId))
      .leftJoin(notebookPages, eq(notebookPages.id, concepts.pageId))
      .where(and(eq(conceptMastery.userId, userId), studiableConcept))
      .orderBy(conceptMastery.dueAt)
      .then((rows) => rows.map((r) => ({ ...r, overdue: !!r.dueAt && r.dueAt <= now }))),
  );
}
