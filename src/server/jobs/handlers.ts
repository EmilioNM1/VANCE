import { and, eq, inArray } from "drizzle-orm";
import { withUser } from "@/db/client";
import { activities, attempts, chunks, claims, conceptMastery, concepts, evaluations } from "@/db/schema";
import { registerJobHandler, PermanentJobError, type JobRow } from "./queue";
import { handleExtract } from "../documents/pipeline";
import { handleAudit } from "../verification/audit";
import { handleBuildKnowledge } from "../knowledge/build";
import { evaluateSemantic } from "../evaluation/semantic";
import { aiConfigured } from "../ai";
import { handleIndexDocument, handleUnindexDocument } from "../retrieval/jobs";
import { handleAnalyzeNotes, handleBuildNoteActivities } from "../notes-intelligence/jobs";

let registered = false;

export function registerAllHandlers() {
  if (registered) return;
  registered = true;
  registerJobHandler("document.extract", handleExtract);
  registerJobHandler("document.audit", handleAudit);
  registerJobHandler("document.build_knowledge", handleBuildKnowledge);
  registerJobHandler("evaluation.reevaluate", handleReevaluate);
  registerJobHandler("document.index", handleIndexDocument);
  registerJobHandler("document.unindex", handleUnindexDocument);
  registerJobHandler("notes.analyze", handleAnalyzeNotes);
  registerJobHandler("notes.build_activities", handleBuildNoteActivities);
}

/** Reevalúa con IA una respuesta que solo tuvo evaluación provisional. */
export async function handleReevaluate(job: JobRow) {
  const { attemptId } = job.payload as { attemptId: string };
  const userId = job.userId!;
  if (!aiConfigured()) throw new Error("IA no configurada todavía");
  const ctx = await withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ att: attempts, ev: evaluations, act: activities })
      .from(attempts)
      .innerJoin(evaluations, eq(evaluations.attemptId, attempts.id))
      .innerJoin(activities, eq(activities.id, attempts.activityId))
      .where(eq(attempts.id, attemptId));
    if (!row) return null;
    const refs = await tx
      .select({ id: claims.id, text: claims.finalText, chunkId: claims.chunkId, page: chunks.page })
      .from(claims)
      .leftJoin(chunks, eq(chunks.id, claims.chunkId))
      .where(and(inArray(claims.id, row.act.claimIds), eq(claims.validated, true)));
    const topic = await tx
      .select({ id: concepts.id, name: concepts.name })
      .from(concepts)
      .where(row.act.documentId ? eq(concepts.documentId, row.act.documentId) : inArray(concepts.id, [row.act.conceptId, ...row.act.relatedConceptIds]));
    return { ...row, refs: refs.filter((r) => r.text) as { id: string; text: string; chunkId: string | null; page: number | null }[], topic };
  });
  if (!ctx || !ctx.ev.provisional) return;
  const text = (ctx.att.response as { text?: string }).text;
  if (!text) throw new PermanentJobError("respuesta sin texto");
  const r = await evaluateSemantic({
    userId,
    prompt: ctx.act.prompt,
    scenario: ctx.act.payload.scenario,
    rubric: ctx.act.rubric,
    answer: text,
    referenceClaims: ctx.refs,
    topicConcepts: ctx.topic,
    nextHintLevel: 1,
    knownMisconceptions: [],
  });
  await withUser(userId, async (tx) => {
    await tx
      .update(evaluations)
      .set({ method: "AI", provisional: false, score: r.score, result: { ...r, references: ctx.ev.result.references, feedback: `Reevaluado con IA: ${r.feedback}` } })
      .where(eq(evaluations.id, ctx.ev.id));
    // Si la evaluación real es peor que la provisional, el concepto vuelve a la cola de repaso
    if (r.score < 0.6 && ctx.ev.score >= 0.6) {
      await tx
        .update(conceptMastery)
        .set({ dueAt: new Date() })
        .where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, ctx.att.conceptId)));
    }
  });
}
