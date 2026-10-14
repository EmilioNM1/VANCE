import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withUser, type Tx } from "@/db/client";
import {
  activities,
  attempts,
  chunks,
  claims,
  conceptConfusions,
  conceptErrors,
  conceptMastery,
  concepts,
  documents,
  evaluations,
  hintUses,
  sessionItems,
  studySessions,
  users,
  type ActivityType,
  type ItemState,
} from "@/db/schema";
import { resolveSettings, type EvaluationResult, type MasteryDimensions } from "@/lib/types";
import { ConflictError, NotFoundError } from "../documents/service";
import { evaluateAttempt, parseResponse } from "../evaluation";
import { recordOutcome } from "../memory/record";
import { enqueueJob } from "../jobs/queue";

type ActivityRow = typeof activities.$inferSelect;
type MasteryRow = typeof conceptMastery.$inferSelect;

export const startSchema = z.object({
  mode: z.enum(["DAILY", "DOCUMENT", "CONCEPT", "CUMULATIVE"]),
  documentId: z.string().uuid().optional(),
  conceptId: z.string().uuid().optional(),
  size: z.number().int().min(3).max(40).optional(),
});

// ───────────────────────────── Selección de actividades ─────────────────────────────

/**
 * Elige la actividad que mejor ataca la debilidad actual del concepto, evitando repetir
 * siempre el mismo tipo. El reconocimiento solo se usa como complemento.
 */
export function chooseActivity(
  acts: Pick<ActivityRow, "id" | "type">[],
  mastery: Pick<MasteryRow, "state" | "dimensions" | "illusionFlag" | "reps"> | null,
  ctx: { recentTypes: ActivityType[]; recurringError: boolean; confused: boolean },
): Pick<ActivityRow, "id" | "type"> | null {
  if (!acts.length) return null;
  const has = (t: ActivityType) => acts.some((a) => a.type === t);
  const d = mastery?.dimensions as MasteryDimensions | undefined;
  const pref: ActivityType[] = [];
  if (!mastery || mastery.state === "NEW") pref.push("FREE_RECALL", "EXPLAIN", "PROCESS_ORDER", "CLOZE");
  if (mastery?.illusionFlag) pref.push("FREE_RECALL", "EXPLAIN");
  if (ctx.recurringError) pref.push("PREDICTION", "EXPLAIN", "CASE");
  if (ctx.confused) pref.push("RELATION", "EXPLAIN");
  if (d) {
    const weak = (v: { value: number | null }) => v.value !== null && v.value < 0.6;
    if (weak(d.completeness) && has("PROCESS_ORDER")) pref.push("PROCESS_ORDER");
    if (weak(d.freeRecall)) pref.push("FREE_RECALL", "CLOZE");
    if (d.application.value === null || weak(d.application)) pref.push("CASE", "PREDICTION");
    if (weak(d.discrimination)) pref.push("RELATION");
  }
  if (mastery?.state === "CONSOLIDATING" || mastery?.state === "MASTERED") pref.push("EXPLAIN", "CASE", "PREDICTION", "RELATION", "FREE_RECALL");
  pref.push("FREE_RECALL", "EXPLAIN", "PROCESS_ORDER", "PREDICTION", "CASE", "RELATION", "CLOZE");
  const recent = new Set(ctx.recentTypes.slice(0, 2));
  for (const t of pref) {
    if (recent.has(t) && pref.some((p) => p !== t && has(p) && !recent.has(p))) continue;
    const a = acts.find((x) => x.type === t);
    if (a) return a;
  }
  return acts.find((a) => a.type !== "RECOGNITION") ?? acts[0]!;
}

/** Intercala para que no aparezcan seguidos ítems del mismo concepto o documento. */
export function interleave<T extends { conceptId: string; documentId: string }>(items: T[]): T[] {
  const out: T[] = [];
  const pool = [...items];
  while (pool.length) {
    const last = out[out.length - 1];
    let idx = pool.findIndex((p) => !last || (p.conceptId !== last.conceptId && p.documentId !== last.documentId));
    if (idx < 0) idx = pool.findIndex((p) => !last || p.conceptId !== last.conceptId);
    if (idx < 0) idx = 0;
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

interface Planned {
  conceptId: string;
  documentId: string;
  activityId: string;
  reason: string;
  noHints: boolean;
}

async function planQueue(tx: Tx, userId: string, input: z.infer<typeof startSchema>, now: Date): Promise<Planned[]> {
  const [u] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  const settings = resolveSettings(u?.settings);
  const size = input.size ?? 12;

  const docFilter = input.documentId ? eq(concepts.documentId, input.documentId) : undefined;
  const conceptRows = await tx
    .select({ id: concepts.id, documentId: concepts.documentId, importance: concepts.importance, createdAt: concepts.createdAt })
    .from(concepts)
    .innerJoin(documents, eq(documents.id, concepts.documentId))
    .where(and(eq(concepts.userId, userId), eq(documents.status, "READY"), docFilter, input.conceptId ? eq(concepts.id, input.conceptId) : undefined));
  if (!conceptRows.length) return [];
  const ids = conceptRows.map((c) => c.id);
  const mastery = await tx.select().from(conceptMastery).where(and(eq(conceptMastery.userId, userId), inArray(conceptMastery.conceptId, ids)));
  const mById = new Map(mastery.map((m) => [m.conceptId, m]));
  const acts = await tx
    .select({ id: activities.id, type: activities.type, conceptId: activities.conceptId })
    .from(activities)
    .where(and(inArray(activities.conceptId, ids), eq(activities.retired, false)));
  const actsBy = new Map<string, { id: string; type: ActivityType }[]>();
  for (const a of acts) actsBy.set(a.conceptId, [...(actsBy.get(a.conceptId) ?? []), a]);
  const recurring = await tx
    .select({ conceptId: conceptErrors.conceptId })
    .from(conceptErrors)
    .where(and(eq(conceptErrors.userId, userId), eq(conceptErrors.resolved, false), gte(conceptErrors.count, 2)));
  const recurringSet = new Set(recurring.map((r) => r.conceptId));
  const confusions = await tx.select({ conceptId: conceptConfusions.conceptId }).from(conceptConfusions).where(eq(conceptConfusions.userId, userId));
  const confusedSet = new Set(confusions.map((c) => c.conceptId));
  const recentAttempts = await tx
    .select({ conceptId: attempts.conceptId, type: activities.type })
    .from(attempts)
    .innerJoin(activities, eq(activities.id, attempts.activityId))
    .where(and(eq(attempts.userId, userId), inArray(attempts.conceptId, ids)))
    .orderBy(desc(attempts.createdAt))
    .limit(400);
  const recentBy = new Map<string, ActivityType[]>();
  for (const r of recentAttempts) recentBy.set(r.conceptId, [...(recentBy.get(r.conceptId) ?? []), r.type]);

  const docOf = new Map(conceptRows.map((c) => [c.id, c.documentId]));
  const plan: Planned[] = [];
  const add = (conceptId: string, reason: string) => {
    if (plan.some((p) => p.conceptId === conceptId)) return;
    const m = mById.get(conceptId) ?? null;
    const a = chooseActivity(actsBy.get(conceptId) ?? [], m, {
      recentTypes: recentBy.get(conceptId) ?? [],
      recurringError: recurringSet.has(conceptId),
      confused: confusedSet.has(conceptId),
    });
    if (!a) return;
    // Evaluación periódica sin pistas para conceptos en consolidación
    const noHints = !!m && (m.state === "CONSOLIDATING" || m.state === "MASTERED") && m.reps % 3 === 2;
    plan.push({ conceptId, documentId: docOf.get(conceptId)!, activityId: a.id, reason: noHints ? `${reason} · evaluación sin pistas` : reason, noHints });
  };

  if (input.mode === "CONCEPT" && input.conceptId) {
    add(input.conceptId, "Práctica del concepto");
    // Después, cada tipo de actividad distinto disponible (recuperar el mismo concepto de varias formas)
    const order: ActivityType[] = ["FREE_RECALL", "EXPLAIN", "PROCESS_ORDER", "PREDICTION", "CASE", "RELATION", "CLOZE"];
    const others = (actsBy.get(input.conceptId) ?? [])
      .filter((a) => a.id !== plan[0]?.activityId && a.type !== "RECOGNITION" && a.type !== (plan[0] && acts.find((x) => x.id === plan[0]!.activityId)?.type))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const seen = new Set<ActivityType>();
    for (const a of others) {
      if (seen.has(a.type) || seen.size >= 4) continue;
      seen.add(a.type);
      plan.push({ conceptId: input.conceptId, documentId: docOf.get(input.conceptId)!, activityId: a.id, reason: "Otra forma de recuperar el mismo concepto", noHints: false });
    }
    return plan;
  }

  // 1) Repasos vencidos (los olvidados primero)
  const due = mastery
    .filter((m) => m.dueAt && m.dueAt <= now)
    .sort((a, b) => (a.state === "RELEARNING" ? -1 : 0) - (b.state === "RELEARNING" ? -1 : 0) || a.dueAt!.getTime() - b.dueAt!.getTime());
  for (const m of due) {
    if (plan.length >= size) break;
    add(m.conceptId, m.state === "RELEARNING" ? "Recuperar un concepto olvidado" : m.reps === 0 ? "Comprobar el recuerdo sin opciones" : "Repaso programado");
  }
  // 2) Conceptos nuevos (respetando el límite diario)
  const introducedToday = mastery.filter((m) => m.reps <= 1 && m.updatedAt >= new Date(now.getTime() - 86400_000)).length;
  const newLimit = Math.max(0, settings.dailyNewConcepts - (input.mode === "DOCUMENT" ? 0 : introducedToday));
  const fresh = conceptRows
    .filter((c) => !mById.has(c.id))
    .sort((a, b) => b.importance - a.importance || a.createdAt.getTime() - b.createdAt.getTime());
  for (const c of fresh.slice(0, newLimit)) {
    if (plan.length >= size) break;
    add(c.id, "Primera recuperación");
  }
  // 3) Recuperación acumulativa: conceptos ya estudiados de otros temas aunque no hayan vencido
  if (input.mode === "DAILY" || input.mode === "CUMULATIVE" || plan.length < size) {
    const others = mastery
      .filter((m) => !plan.some((p) => p.conceptId === m.conceptId) && m.reps > 0)
      .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
    const quota = input.mode === "CUMULATIVE" ? size : Math.max(2, Math.floor(size / 5));
    for (const m of others.slice(0, quota)) {
      if (plan.length >= size) break;
      add(m.conceptId, "Repaso acumulativo (mezcla de temas)");
    }
  }
  return interleave(plan);
}

export async function startSession(userId: string, raw: unknown) {
  const input = startSchema.parse(raw);
  return withUser(userId, async (tx) => {
    const [active] = await tx
      .select()
      .from(studySessions)
      .where(
        and(
          eq(studySessions.userId, userId),
          eq(studySessions.status, "ACTIVE"),
          eq(studySessions.mode, input.mode),
          input.documentId ? eq(studySessions.documentId, input.documentId) : isNull(studySessions.documentId),
        ),
      )
      .orderBy(desc(studySessions.startedAt))
      .limit(1);
    if (active && input.mode !== "CONCEPT") return { sessionId: active.id, resumed: true };
    const plan = await planQueue(tx, userId, input, new Date());
    if (!plan.length) throw new ConflictError("No hay actividades disponibles ahora mismo. Procesa un documento o vuelve cuando tengas repasos pendientes.");
    const [s] = await tx.insert(studySessions).values({ userId, mode: input.mode, documentId: input.documentId ?? null }).returning();
    await tx.insert(sessionItems).values(plan.map((p, i) => ({ userId, sessionId: s!.id, activityId: p.activityId, ord: i, reason: p.reason, noHints: p.noHints })));
    return { sessionId: s!.id, resumed: false };
  });
}

// ───────────────────────────── Vista de la sesión ─────────────────────────────

export interface ItemView {
  itemId: string;
  ord: number;
  reason: string;
  state: ItemState;
  noHints: boolean;
  hintLevel: number;
  maxHintLevel: number;
  attemptsCount: number;
  explanationShown: boolean;
  activity: {
    id: string;
    type: ActivityType;
    prompt: string;
    payload: ActivityRow["payload"];
    conceptId: string;
    conceptName: string;
    documentTitle: string;
  };
  hints: { level: number; text: string }[];
  explanation: string | null;
  lastEvaluation: (EvaluationResult & { provisional: boolean; method: string }) | null;
}

export interface SessionView {
  session: typeof studySessions.$inferSelect;
  total: number;
  done: number;
  current: ItemView | null;
  summary: { itemId: string; conceptName: string; type: ActivityType; firstScore: number | null; finalScore: number | null; state: ItemState }[];
}

/** Elimina del resultado lo que no debe verse antes de tiempo (explicación completa, pista interna). */
function sanitizeEvaluation(r: EvaluationResult, revealExplanation: boolean): EvaluationResult {
  const { hint: _hint, explanation, ...rest } = r;
  void _hint;
  return { ...rest, explanation: revealExplanation ? explanation : undefined, references: revealExplanation ? r.references : [] };
}

export async function getSessionView(userId: string, sessionId: string): Promise<SessionView> {
  return withUser(userId, async (tx) => {
    const [s] = await tx.select().from(studySessions).where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)));
    if (!s) throw new NotFoundError("Sesión");
    const items = await tx
      .select({ item: sessionItems, type: activities.type, conceptName: concepts.name })
      .from(sessionItems)
      .innerJoin(activities, eq(activities.id, sessionItems.activityId))
      .innerJoin(concepts, eq(concepts.id, activities.conceptId))
      .where(eq(sessionItems.sessionId, sessionId))
      .orderBy(asc(sessionItems.ord));
    const done = items.filter((i) => i.item.state === "DONE" || i.item.state === "SKIPPED").length;
    let current = items.find((i) => i.item.state !== "DONE" && i.item.state !== "SKIPPED")?.item ?? null;
    if (current && current.state === "PENDING" && s.status === "ACTIVE") {
      [current] = await tx.update(sessionItems).set({ state: "AWAITING_ANSWER", presentedAt: new Date() }).where(eq(sessionItems.id, current.id)).returning();
    }
    if (!current && s.status === "ACTIVE") {
      await tx.update(studySessions).set({ status: "COMPLETED", endedAt: new Date() }).where(eq(studySessions.id, s.id));
      s.status = "COMPLETED";
    }
    return {
      session: s,
      total: items.length,
      done,
      current: current ? await buildItemView(tx, userId, current) : null,
      summary: items.map((i) => ({ itemId: i.item.id, conceptName: i.conceptName, type: i.type, firstScore: i.item.firstScore, finalScore: i.item.finalScore, state: i.item.state })),
    };
  });
}

async function buildItemView(tx: Tx, userId: string, item: typeof sessionItems.$inferSelect): Promise<ItemView> {
  const [row] = await tx
    .select({ a: activities, conceptName: concepts.name, documentTitle: documents.title })
    .from(activities)
    .innerJoin(concepts, eq(concepts.id, activities.conceptId))
    .innerJoin(documents, eq(documents.id, activities.documentId))
    .where(eq(activities.id, item.activityId));
  const [u] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  const settings = resolveSettings(u?.settings);
  const hints = await tx.select().from(hintUses).where(eq(hintUses.sessionItemId, item.id)).orderBy(asc(hintUses.level));
  const [last] = await tx
    .select({ e: evaluations })
    .from(attempts)
    .innerJoin(evaluations, eq(evaluations.attemptId, attempts.id))
    .where(eq(attempts.sessionItemId, item.id))
    .orderBy(desc(attempts.createdAt))
    .limit(1);
  const a = row!.a;
  const reveal = item.explanationShown || item.state === "DONE";
  return {
    itemId: item.id,
    ord: item.ord,
    reason: item.reason,
    state: item.state,
    noHints: item.noHints,
    hintLevel: item.hintLevel,
    maxHintLevel: item.noHints ? 0 : settings.maxHintLevel,
    attemptsCount: item.attemptsCount,
    explanationShown: item.explanationShown,
    activity: { id: a.id, type: a.type, prompt: a.prompt, payload: a.payload, conceptId: a.conceptId, conceptName: row!.conceptName, documentTitle: row!.documentTitle },
    hints: hints.filter((h) => h.level < 4).map((h) => ({ level: h.level, text: h.text })),
    explanation: item.explanationShown ? (hints.find((h) => h.level === 4)?.text ?? a.rubric.explanation) : null,
    lastEvaluation: last ? { ...sanitizeEvaluation(last.e.result, reveal), provisional: last.e.provisional, method: last.e.method } : null,
  };
}

async function loadItemForUpdate(tx: Tx, userId: string, itemId: string) {
  const [item] = await tx
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.id, itemId), eq(sessionItems.userId, userId)))
    .for("update");
  if (!item) throw new NotFoundError("Actividad de la sesión");
  const [s] = await tx.select().from(studySessions).where(eq(studySessions.id, item.sessionId));
  if (s?.status !== "ACTIVE") throw new ConflictError("La sesión ya ha terminado.");
  return { item, session: s };
}

// ───────────────────────────── Pistas ─────────────────────────────

async function revealHint(tx: Tx, userId: string, item: typeof sessionItems.$inferSelect, level: number, adaptiveHint?: string) {
  const [a] = await tx.select().from(activities).where(eq(activities.id, item.activityId));
  if (!a) throw new NotFoundError("Actividad");
  if (level >= 4) {
    const [lastEval] = await tx
      .select({ r: evaluations.result })
      .from(attempts)
      .innerJoin(evaluations, eq(evaluations.attemptId, attempts.id))
      .where(eq(attempts.sessionItemId, item.id))
      .orderBy(desc(attempts.createdAt))
      .limit(1);
    const text = `${lastEval?.r.explanation || a.rubric.explanation}\n\nRespuesta modelo:\n${a.rubric.referenceAnswer}`;
    await tx.insert(hintUses).values({ userId, sessionItemId: item.id, level: 4, text, adaptive: !!lastEval });
    await tx
      .update(sessionItems)
      .set({ hintLevel: 4, explanationShown: true, state: "AWAITING_POST_EXPLANATION" })
      .where(eq(sessionItems.id, item.id));
    return;
  }
  const text = adaptiveHint?.trim() || a.rubric.hints[level - 1] || a.rubric.hints[a.rubric.hints.length - 1]!;
  await tx.insert(hintUses).values({ userId, sessionItemId: item.id, level, text, adaptive: !!adaptiveHint });
  await tx.update(sessionItems).set({ hintLevel: level }).where(eq(sessionItems.id, item.id));
}

/** El usuario pide más ayuda. La pista se adapta a su último error cuando es posible. */
export async function requestHint(userId: string, itemId: string) {
  await withUser(userId, async (tx) => {
    const { item } = await loadItemForUpdate(tx, userId, itemId);
    if (item.noHints) throw new ConflictError("Esta es una evaluación sin pistas.");
    if (item.state !== "AWAITING_ANSWER" && item.state !== "AWAITING_RETRY") throw new ConflictError("Ahora no se puede pedir una pista.");
    const [u] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
    const max = resolveSettings(u?.settings).maxHintLevel;
    const level = item.hintLevel + 1;
    if (level > max) throw new ConflictError("Has alcanzado el nivel máximo de ayuda configurado.");
    const [lastEval] = await tx
      .select({ r: evaluations.result })
      .from(attempts)
      .innerJoin(evaluations, eq(evaluations.attemptId, attempts.id))
      .where(eq(attempts.sessionItemId, item.id))
      .orderBy(desc(attempts.createdAt))
      .limit(1);
    await revealHint(tx, userId, item, level, lastEval?.r.hint);
    await tx.update(studySessions).set({ lastActiveAt: new Date() }).where(eq(studySessions.id, item.sessionId));
  });
}

// ───────────────────────────── Envío de respuestas ─────────────────────────────

export const submitSchema = z.object({
  response: z.unknown(),
  confidence: z.number().int().min(1).max(4).nullable().optional(),
  inputMode: z.enum(["TEXT", "VOICE", "INTERACTIVE"]).optional(),
});

/** Nivel de pista inicial según la respuesta y el historial (pista adaptativa). */
export function autoHintLevel(score: number, currentLevel: number, recurringError: boolean, max: number) {
  let lvl = currentLevel + 1;
  if (score < 0.3 || recurringError) lvl = Math.max(lvl, 2);
  return Math.min(lvl, max);
}

export async function submitAttempt(userId: string, itemId: string, raw: unknown) {
  const body = submitSchema.parse(raw);
  // 1) Carga y validación (transacción corta)
  const ctx = await withUser(userId, async (tx) => {
    const { item } = await loadItemForUpdate(tx, userId, itemId);
    if (!["AWAITING_ANSWER", "AWAITING_RETRY", "AWAITING_POST_EXPLANATION"].includes(item.state))
      throw new ConflictError("Esta actividad no está esperando una respuesta.");
    const [a] = await tx.select().from(activities).where(eq(activities.id, item.activityId));
    if (!a) throw new NotFoundError("Actividad");
    const refs = a.claimIds.length
      ? await tx
          .select({ id: claims.id, text: claims.finalText, chunkId: claims.chunkId, page: chunks.page })
          .from(claims)
          .innerJoin(chunks, eq(chunks.id, claims.chunkId))
          .where(and(inArray(claims.id, a.claimIds), eq(claims.validated, true)))
      : [];
    const topic = await tx.select({ id: concepts.id, name: concepts.name }).from(concepts).where(eq(concepts.documentId, a.documentId));
    const errs = await tx
      .select({ tag: conceptErrors.tag, description: conceptErrors.description, count: conceptErrors.count })
      .from(conceptErrors)
      .where(and(eq(conceptErrors.userId, userId), eq(conceptErrors.conceptId, a.conceptId), eq(conceptErrors.resolved, false)));
    const [u] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
    return { item, activity: a, refs: refs.filter((r) => r.text) as { id: string; text: string; chunkId: string; page: number | null }[], topic, errs, settings: resolveSettings(u?.settings) };
  });
  const { item, activity, settings } = ctx;
  const response = parseResponse(activity.type, body.response);
  const phase = item.state === "AWAITING_POST_EXPLANATION" ? "POST_EXPLANATION" : item.attemptsCount === 0 ? "INITIAL" : "RETRY";

  // 2) Evaluación en servidor (fuera de la transacción: puede tardar si usa IA)
  const evalOut = await evaluateAttempt(activity, response, {
    userId,
    referenceClaims: ctx.refs,
    topicConcepts: ctx.topic,
    nextHintLevel: Math.min(3, item.hintLevel + 1),
    knownMisconceptions: ctx.errs.map((e) => e.description),
  });
  const result = evalOut.result;

  // 3) Persistencia y transición de estado (con bloqueo para evitar envíos duplicados)
  const outcome = await withUser(userId, async (tx) => {
    const { item: fresh } = await loadItemForUpdate(tx, userId, itemId);
    if (fresh.attemptsCount !== item.attemptsCount || fresh.state !== item.state) throw new ConflictError("La respuesta ya se había enviado.");
    const now = new Date();
    const latencyMs = fresh.presentedAt ? now.getTime() - fresh.presentedAt.getTime() : null;
    const [att] = await tx
      .insert(attempts)
      .values({
        userId,
        sessionItemId: fresh.id,
        activityId: activity.id,
        conceptId: activity.conceptId,
        phase,
        attemptNo: fresh.attemptsCount + 1,
        response,
        inputMode: body.inputMode ?? (["PROCESS_ORDER", "CLOZE", "RECOGNITION"].includes(activity.type) ? "INTERACTIVE" : "TEXT"),
        confidence: body.confidence ?? null,
        hintLevelAtSubmit: fresh.hintLevel,
        latencyMs,
      })
      .returning();
    await tx.insert(evaluations).values({ userId, attemptId: att!.id, method: evalOut.method, score: result.score, result, provisional: evalOut.provisional });
    if (evalOut.provisional) await enqueueJob("evaluation.reevaluate", { attemptId: att!.id }, userId, { runAt: new Date(Date.now() + 10 * 60_000), maxAttempts: 6 });

    const firstScore = phase === "INITIAL" ? result.score : fresh.firstScore ?? result.score;
    const success = result.verdict === "CORRECT" || result.score >= 0.85;
    // Error que ya había cometido antes → la ayuda empieza en un nivel más alto
    const knownTags = new Set(ctx.errs.map((e) => e.tag));
    const recurring = result.criticalErrors.some((c) => knownTags.has(c.tag));
    let state: ItemState;
    if (success || phase === "POST_EXPLANATION" || fresh.noHints || result.verdict === "AMBIGUOUS") state = "DONE";
    else if (fresh.attemptsCount < settings.retriesBeforeExplanation) state = "AWAITING_RETRY";
    else state = "AWAITING_POST_EXPLANATION";

    await tx
      .update(sessionItems)
      .set({
        attemptsCount: fresh.attemptsCount + 1,
        firstScore,
        finalScore: result.score,
        state: state === "AWAITING_POST_EXPLANATION" ? fresh.state : state,
        completedAt: state === "DONE" ? now : null,
      })
      .where(eq(sessionItems.id, fresh.id));
    await tx.update(studySessions).set({ lastActiveAt: now }).where(eq(studySessions.id, fresh.sessionId));

    if (state === "AWAITING_RETRY") {
      const lvl = autoHintLevel(result.score, fresh.hintLevel, recurring, settings.maxHintLevel);
      await revealHint(tx, userId, { ...fresh, attemptsCount: fresh.attemptsCount + 1 }, lvl, lvl < 4 ? result.hint : undefined);
    } else if (state === "AWAITING_POST_EXPLANATION") {
      await revealHint(tx, userId, fresh, 4);
    }

    let memory = null;
    if (state === "DONE") {
      const [hintRow] = await tx
        .select({ max: sql<number>`coalesce(max(${hintUses.level}), 0)::int` })
        .from(hintUses)
        .where(eq(hintUses.sessionItemId, fresh.id));
      const [firstAtt] = await tx
        .select({ confidence: attempts.confidence })
        .from(attempts)
        .where(and(eq(attempts.sessionItemId, fresh.id), eq(attempts.phase, "INITIAL")));
      // Errores y confusiones de TODOS los intentos del ítem (no solo del último)
      const itemEvals = await tx
        .select({ r: evaluations.result })
        .from(attempts)
        .innerJoin(evaluations, eq(evaluations.attemptId, attempts.id))
        .where(eq(attempts.sessionItemId, fresh.id));
      const allErrors = [...new Map(itemEvals.flatMap((e) => e.r.criticalErrors).map((e) => [e.tag, e])).values()];
      const allConfusions = [...new Set(itemEvals.flatMap((e) => e.r.confusedWithConceptIds))];
      memory = await recordOutcome(tx, userId, {
        conceptId: activity.conceptId,
        attemptId: att!.id,
        activityType: activity.type,
        firstScore,
        finalScore: result.score,
        hintsUsed: hintRow?.max ?? 0,
        explanationShown: fresh.explanationShown,
        confidence: firstAtt?.confidence ?? null,
        criticalErrors: allErrors,
        confusedWithConceptIds: allConfusions,
        provisional: evalOut.provisional,
        ambiguous: result.verdict === "AMBIGUOUS",
      });
      // Reconocer no basta: tras acertar una opción múltiple se pide recuperarlo sin opciones
      if (activity.type === "RECOGNITION") await appendFollowUp(tx, userId, fresh.sessionId, activity.conceptId, "Comprobación: ¿lo recuerdas sin opciones?");
      // Tras necesitar la explicación, se programa otra recuperación del mismo concepto al final
      else if (fresh.explanationShown) await appendFollowUp(tx, userId, fresh.sessionId, activity.conceptId, "Nueva recuperación tras la corrección", activity.id);
    }
    return { state, memory };
  });
  return { ...outcome, evaluation: { ...sanitizeEvaluation(result, outcome.state === "DONE"), provisional: evalOut.provisional, method: evalOut.method } };
}

async function appendFollowUp(tx: Tx, userId: string, sessionId: string, conceptId: string, reason: string, excludeActivityId?: string) {
  const acts = await tx
    .select({ id: activities.id, type: activities.type })
    .from(activities)
    .where(and(eq(activities.conceptId, conceptId), eq(activities.retired, false), ne(activities.type, "RECOGNITION")));
  const pref: ActivityType[] = ["FREE_RECALL", "EXPLAIN", "PROCESS_ORDER", "CLOZE", "PREDICTION", "CASE", "RELATION"];
  const pick = pref.map((t) => acts.find((a) => a.type === t && a.id !== excludeActivityId)).find(Boolean) ?? acts.find((a) => a.id !== excludeActivityId);
  if (!pick) return;
  const existing = await tx.select({ activityId: sessionItems.activityId, ord: sessionItems.ord }).from(sessionItems).where(eq(sessionItems.sessionId, sessionId));
  if (existing.filter((e) => e.activityId === pick.id).length >= 1 && reason.startsWith("Comprobación")) return;
  if (existing.length >= 60) return;
  const ord = Math.max(...existing.map((e) => e.ord)) + 1;
  await tx.insert(sessionItems).values({ userId, sessionId, activityId: pick.id, ord, reason });
}

export async function skipItem(userId: string, itemId: string) {
  await withUser(userId, async (tx) => {
    const { item } = await loadItemForUpdate(tx, userId, itemId);
    if (item.state === "DONE" || item.state === "SKIPPED") throw new ConflictError("Esta actividad ya está cerrada.");
    await tx.update(sessionItems).set({ state: "SKIPPED", completedAt: new Date() }).where(eq(sessionItems.id, item.id));
  });
}

export async function endSession(userId: string, sessionId: string) {
  await withUser(userId, async (tx) => {
    const res = await tx
      .update(studySessions)
      .set({ status: "ABANDONED", endedAt: new Date() })
      .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId), eq(studySessions.status, "ACTIVE")))
      .returning();
    if (!res.length) throw new NotFoundError("Sesión activa");
  });
}

export async function listActiveSessions(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: studySessions.id,
        mode: studySessions.mode,
        documentId: studySessions.documentId,
        startedAt: studySessions.startedAt,
        lastActiveAt: studySessions.lastActiveAt,
        total: sql<number>`(select count(*)::int from session_items si where si.session_id = ${studySessions.id})`,
        done: sql<number>`(select count(*)::int from session_items si where si.session_id = ${studySessions.id} and si.state in ('DONE','SKIPPED'))`,
      })
      .from(studySessions)
      .where(and(eq(studySessions.userId, userId), eq(studySessions.status, "ACTIVE")))
      .orderBy(desc(studySessions.lastActiveAt)),
  );
}

export async function dueCount(userId: string, until = new Date()) {
  return withUser(userId, async (tx) => {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(conceptMastery)
      .innerJoin(concepts, eq(concepts.id, conceptMastery.conceptId))
      .innerJoin(documents, eq(documents.id, concepts.documentId))
      .where(and(eq(conceptMastery.userId, userId), lte(conceptMastery.dueAt, until), eq(documents.status, "READY")));
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(concepts)
      .innerJoin(documents, eq(documents.id, concepts.documentId))
      .leftJoin(conceptMastery, and(eq(conceptMastery.conceptId, concepts.id), eq(conceptMastery.userId, userId)))
      .where(and(eq(concepts.userId, userId), eq(documents.status, "READY"), or(isNull(conceptMastery.conceptId))));
    return { due: r?.n ?? 0, fresh: n?.n ?? 0 };
  });
}
