import { z } from "zod";
import type { activities } from "@/db/schema";
import type { EvaluationResult } from "@/lib/types";
import { aiConfigured } from "../ai";
import { AiNotConfiguredError, AiUnavailableError, AiBudgetExceededError, AiOutputError } from "../ai/errors";
import { evaluateCloze, evaluateOrder, evaluateRecognition } from "./rules";
import { evaluateSemantic, heuristicEvaluate } from "./semantic";

type Activity = typeof activities.$inferSelect;

export const responseSchemas = {
  open: z.object({ text: z.string().max(8000) }),
  order: z.object({ order: z.array(z.string().max(20)).max(40), justification: z.string().max(4000).optional() }),
  cloze: z.object({ blanks: z.record(z.string(), z.string().max(200)) }),
  recognition: z.object({ optionId: z.string().max(20) }),
};

export function parseResponse(type: Activity["type"], raw: unknown) {
  switch (type) {
    case "PROCESS_ORDER":
      return responseSchemas.order.parse(raw);
    case "CLOZE":
      return responseSchemas.cloze.parse(raw);
    case "RECOGNITION":
      return responseSchemas.recognition.parse(raw);
    default:
      return responseSchemas.open.parse(raw);
  }
}

export interface EvalContext {
  userId: string;
  referenceClaims: { id: string; text: string; chunkId: string; page: number | null }[];
  topicConcepts: { id: string; name: string }[];
  nextHintLevel: number;
  knownMisconceptions: string[];
}

export interface EvalOutcome {
  method: "RULES" | "AI" | "HEURISTIC_PROVISIONAL";
  provisional: boolean;
  result: EvaluationResult;
}

/**
 * Evalúa SIEMPRE en el servidor con la clave de respuesta/rúbrica almacenada.
 * - Procesos, huecos y reconocimiento: reglas verificables.
 * - Respuestas abiertas: evaluación semántica con IA; si no está disponible, evaluación
 *   provisional por términos clave, marcada como tal y reevaluada después.
 */
export async function evaluateAttempt(activity: Activity, response: unknown, ctx: EvalContext): Promise<EvalOutcome> {
  const refs = ctx.referenceClaims.map((c) => ({ claimId: c.id, chunkId: c.chunkId, page: c.page, text: c.text }));
  const withRefs = (r: EvaluationResult): EvaluationResult => ({ ...r, references: refs });

  if (activity.type === "PROCESS_ORDER") {
    const r = response as z.infer<typeof responseSchemas.order>;
    const items = new Map((activity.payload.items ?? []).map((i) => [i.id, i.text]));
    const base = evaluateOrder(r.order, activity.answerKey, activity.rubric, items);
    // La justificación se valora semánticamente (si hay IA) como retroalimentación adicional
    if (r.justification?.trim() && aiConfigured()) {
      try {
        const sem = await evaluateSemantic({
          userId: ctx.userId,
          prompt: `Explica por qué cada paso del proceso conduce al siguiente: ${activity.prompt}`,
          rubric: { ...activity.rubric, precision: "CONCEPTUAL" },
          answer: r.justification,
          referenceClaims: ctx.referenceClaims,
          topicConcepts: ctx.topicConcepts,
          nextHintLevel: ctx.nextHintLevel,
          knownMisconceptions: ctx.knownMisconceptions,
        });
        base.feedback = `${base.feedback} Sobre tu justificación: ${sem.feedback}`;
        base.incorrect.push(...sem.incorrect.filter((i) => i.explanation));
        base.criticalErrors = sem.criticalErrors;
        base.hint = sem.hint;
      } catch {
        base.feedback += " (La justificación no pudo evaluarse ahora.)";
      }
    }
    return { method: "RULES", provisional: false, result: withRefs(base) };
  }
  if (activity.type === "CLOZE") {
    const r = response as z.infer<typeof responseSchemas.cloze>;
    return { method: "RULES", provisional: false, result: withRefs(evaluateCloze(r.blanks, activity.answerKey, activity.rubric)) };
  }
  if (activity.type === "RECOGNITION") {
    const r = response as z.infer<typeof responseSchemas.recognition>;
    return { method: "RULES", provisional: false, result: withRefs(evaluateRecognition(r.optionId, activity.answerKey, activity.rubric)) };
  }

  const text = (response as z.infer<typeof responseSchemas.open>).text.trim();
  if (!text) {
    const r = heuristicEvaluate(activity.rubric, "");
    return {
      method: "RULES",
      provisional: false,
      result: withRefs({ ...r, feedback: "No has escrito nada. Intenta recuperar aunque sea una parte: el esfuerzo de recordar es lo que fortalece la memoria." }),
    };
  }
  try {
    const r = await evaluateSemantic({
      userId: ctx.userId,
      prompt: activity.prompt,
      scenario: activity.payload.scenario,
      rubric: activity.rubric,
      answer: text,
      referenceClaims: ctx.referenceClaims,
      topicConcepts: ctx.topicConcepts,
      nextHintLevel: ctx.nextHintLevel,
      knownMisconceptions: ctx.knownMisconceptions,
    });
    return { method: "AI", provisional: false, result: withRefs(r) };
  } catch (e) {
    if (e instanceof AiUnavailableError || e instanceof AiNotConfiguredError || e instanceof AiBudgetExceededError || e instanceof AiOutputError) {
      return { method: "HEURISTIC_PROVISIONAL", provisional: true, result: withRefs(heuristicEvaluate(activity.rubric, text)) };
    }
    throw e;
  }
}
