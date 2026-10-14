import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, withUser } from "@/db/client";
import { claims, jobs, notebookPages, noteReviews, type ActivityType } from "@/db/schema";
import { enqueueJob, PermanentJobError, type JobRow } from "../jobs/queue";
import { aiConfigured } from "../ai";
import { AiNotConfiguredError } from "../ai/errors";
import { ConflictError, NotFoundError } from "../documents/service";
import { createReview, runNoteReview } from "./analyze";
import { buildPageActivities, type NoteActivityMode } from "./activities";
import { decideClaim } from "../verification/review";
import { snapshotPage } from "../notebooks/service";

export async function handleAnalyzeNotes(job: JobRow) {
  const { reviewId } = job.payload as { reviewId: string };
  try {
    await runNoteReview(job.userId!, reviewId);
  } catch (e) {
    if (e instanceof AiNotConfiguredError) throw new PermanentJobError(e.message);
    throw e;
  }
}

export async function handleBuildNoteActivities(job: JobRow) {
  const { pageId, mode, types } = job.payload as { pageId: string; mode: NoteActivityMode; types?: ActivityType[] };
  const userId = job.userId!;
  // Si los apuntes cambiaron desde el último análisis, primero se contrastan (no se aprende algo sin revisar)
  if (mode !== "BOOK") {
    const [p] = await withUser(userId, (tx) => tx.select().from(notebookPages).where(eq(notebookPages.id, pageId)));
    if (!p) return;
    if (p.lastAnalyzedHash !== p.contentHash) {
      const r = await createReview(userId, pageId, { scope: "PAGE" });
      if (r) await runNoteReview(userId, r.id);
    }
  }
  const result = await buildPageActivities(userId, pageId, mode, types);
  await getDb().update(jobs).set({ result: result as unknown as Record<string, unknown> }).where(eq(jobs.id, job.id));
}

// ───────────────────────────── Acciones del usuario ─────────────────────────────

export const analyzeInput = z.object({
  scope: z.enum(["PAGE", "SELECTION"]),
  selectionText: z.string().max(20_000).optional(),
  externalVerification: z.boolean().optional(),
});

export async function requestAnalysis(userId: string, pageId: string, raw: unknown) {
  const input = analyzeInput.parse(raw);
  if (!aiConfigured()) throw new ConflictError("El análisis de apuntes requiere IA (ANTHROPIC_API_KEY).");
  if (input.scope === "SELECTION" && (input.selectionText?.trim().length ?? 0) < 20) throw new ConflictError("Selecciona un fragmento más largo para contrastarlo.");
  // Evita repetir un análisis de página si el contenido no ha cambiado (sin coste)
  if (input.scope === "PAGE") {
    const [p] = await withUser(userId, (tx) => tx.select().from(notebookPages).where(and(eq(notebookPages.id, pageId), eq(notebookPages.userId, userId))));
    if (!p) throw new NotFoundError("Página");
    if (p.lastAnalyzedHash === p.contentHash && !input.externalVerification) {
      const [last] = await withUser(userId, (tx) => tx.select().from(noteReviews).where(eq(noteReviews.pageId, pageId)).orderBy(noteReviews.createdAt));
      if (last) return { reviewId: last.id, cached: true };
    }
  }
  const r = await createReview(userId, pageId, input);
  if (!r) throw new NotFoundError("Página");
  await enqueueJob("notes.analyze", { reviewId: r.id }, userId, { maxAttempts: 2 });
  return { reviewId: r.id, cached: false };
}

export const buildInput = z.object({
  mode: z.enum(["NOTES", "BOOK", "COMBINED"]),
  types: z.array(z.enum(["FREE_RECALL", "EXPLAIN", "PROCESS_ORDER", "CLOZE", "RELATION", "PREDICTION", "CASE", "RECOGNITION", "DIAGRAM"])).max(9).optional(),
});

export async function requestActivities(userId: string, pageId: string, raw: unknown) {
  const input = buildInput.parse(raw);
  if (input.mode !== "BOOK" && !aiConfigured()) throw new ConflictError("Crear preguntas a partir de tus apuntes requiere IA (ANTHROPIC_API_KEY).");
  const [p] = await withUser(userId, (tx) => tx.select({ id: notebookPages.id }).from(notebookPages).where(and(eq(notebookPages.id, pageId), eq(notebookPages.userId, userId))));
  if (!p) throw new NotFoundError("Página");
  const job = await enqueueJob("notes.build_activities", { pageId, mode: input.mode, types: input.types }, userId, { maxAttempts: 2 });
  return { jobId: job.id };
}

export async function getJobForUser(userId: string, jobId: string) {
  const [j] = await getDb().select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)));
  if (!j) throw new NotFoundError("Tarea");
  return { id: j.id, status: j.status, result: j.result, error: j.status === "FAILED" ? j.lastError : null, type: j.type };
}

/**
 * Decisión sobre una observación de los apuntes. Antes de aplicar una corrección se guarda una
 * versión de la página, de modo que el texto original nunca se pierde.
 */
export async function decideNoteClaim(userId: string, claimId: string, raw: unknown) {
  const [c] = await withUser(userId, (tx) => tx.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.userId, userId))));
  if (!c || c.sourceKind !== "NOTE" || !c.pageId) throw new NotFoundError("Observación");
  const decision = (raw as { decision?: string })?.decision;
  if (decision === "ACCEPTED_CORRECTION" || decision === "EDITED") await withUser(userId, (tx) => snapshotPage(tx, userId, c.pageId!, "BEFORE_CORRECTION"));
  const updated = await decideClaim(userId, claimId, raw);
  const replace =
    (decision === "ACCEPTED_CORRECTION" || decision === "EDITED") && c.quote && updated.finalText ? { from: c.quote, to: updated.finalText } : null;
  return { claim: updated, replace };
}
