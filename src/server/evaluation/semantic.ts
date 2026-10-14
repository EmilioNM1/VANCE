import { z } from "zod";
import type { ElementStatus, EvaluationResult, Rubric } from "@/lib/types";
import { aiStructured } from "../ai";
import { normalize, verdictFor } from "./rules";

export const semanticEvalSchema = z.object({
  elements: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["PRESENT", "PARTIAL", "ABSENT", "INCORRECT"]),
      evidence: z.string(),
      note: z.string(),
    }),
  ),
  criticalErrors: z.array(z.object({ rubricId: z.string().nullable(), tag: z.string(), description: z.string() })),
  incorrectStatements: z.array(z.object({ statement: z.string(), explanation: z.string() })),
  ambiguous: z.boolean(),
  ambiguityNote: z.string(),
  confusedWithConcepts: z.array(z.string()),
  feedback: z.string(),
  nextHint: z.string(),
  explanation: z.string(),
  nextRecommendation: z.string(),
});

export type SemanticEval = z.infer<typeof semanticEvalSchema>;

const STATUS_VALUE: Record<ElementStatus, number> = { PRESENT: 1, PARTIAL: 0.5, ABSENT: 0, INCORRECT: 0 };

/**
 * Puntuación DETERMINISTA a partir de los juicios por elemento (la IA no fija la nota).
 * Crédito parcial por elemento; penalización por errores conceptuales graves.
 */
export function scoreFromElements(
  rubric: Rubric,
  statuses: Map<string, ElementStatus>,
  criticalErrorCount: number,
  ambiguous: boolean,
): number {
  const all = [...rubric.essentialElements, ...rubric.relations];
  const total = all.reduce((a, e) => a + e.weight, 0);
  if (!total) return 0;
  const got = all.reduce((a, e) => a + e.weight * STATUS_VALUE[statuses.get(e.id) ?? "ABSENT"], 0);
  const penalty = ambiguous ? 0 : Math.min(0.6, 0.2 * criticalErrorCount);
  return Math.max(0, Math.round((got / total - penalty) * 100) / 100);
}

const EVAL_SYSTEM = `Evalúas respuestas de estudiantes en un entrenador de RECUERDO ACTIVO. El estudiante respondió de memoria.
Recibes la consigna, la rúbrica (elementos esenciales y relaciones con su id), los errores graves previstos, las afirmaciones validadas de referencia y la respuesta.
Evalúa el SIGNIFICADO, no la redacción:
- Acepta sinónimos, paráfrasis y explicaciones con otras palabras si son conceptualmente correctas. No penalices diferencias de estilo ni que no use los términos del libro.
- PRESENT: el elemento aparece correcto; PARTIAL: incompleto o impreciso; ABSENT: no aparece; INCORRECT: aparece pero es erróneo.
- "evidence": cita breve de la respuesta del estudiante que justifica el estado (vacío si ABSENT).
- Distingue una definición repetida de memoria de una comprensión del mecanismo: si solo enumera términos sin relacionarlos, las relaciones son ABSENT o PARTIAL.
- "criticalErrors": errores conceptuales graves presentes en la respuesta (usa rubricId si coincide con uno previsto; tag en kebab-case).
- "incorrectStatements": afirmaciones falsas del estudiante con una explicación breve.
- Si la consigna es ambigua, falta contexto o hay discrepancia legítima entre fuentes que hace defendible la respuesta, marca ambiguous=true y explícalo en ambiguityNote en lugar de penalizar.
- "confusedWithConcepts": nombres (de la lista de conceptos del tema) que el estudiante parece confundir con el evaluado.
- "feedback": 1-3 frases en español: qué hizo bien y qué aspecto revisar, SIN revelar la respuesta.
- "nextHint": pista para el nivel de ayuda indicado, adaptada a lo que le falta o tiene mal, que NO revele la respuesta completa.
- "explanation": corrección completa y didáctica, centrada en sus errores y omisiones, basada en las afirmaciones validadas.
- "nextRecommendation": breve sugerencia de qué practicar después.
No inventes información que no esté en las afirmaciones validadas.`;

export interface SemanticContext {
  userId: string;
  prompt: string;
  scenario?: string;
  rubric: Rubric;
  answer: string;
  referenceClaims: { id: string; text: string }[];
  topicConcepts: { id: string; name: string }[];
  nextHintLevel: number;
  knownMisconceptions: string[];
}

export async function evaluateSemantic(ctx: SemanticContext): Promise<EvaluationResult> {
  const r = ctx.rubric;
  const res = await aiStructured({
    operation: "evaluation.semantic",
    userId: ctx.userId,
    effort: "low",
    maxTokens: 8000,
    system: EVAL_SYSTEM,
    content: [
      {
        type: "text",
        text: [
          `CONSIGNA: ${ctx.prompt}`,
          ctx.scenario ? `ESCENARIO: ${ctx.scenario}` : "",
          `PRECISIÓN REQUERIDA: ${r.precision === "EXACT" ? "exacta (cifras y términos técnicos deben ser correctos)" : "conceptual"}`,
          `ELEMENTOS ESENCIALES:\n${r.essentialElements.map((e) => `- [${e.id}] ${e.description} (peso ${e.weight}; términos aceptables: ${e.keyTerms.join(", ") || "—"})`).join("\n")}`,
          r.relations.length ? `RELACIONES REQUERIDAS:\n${r.relations.map((e) => `- [${e.id}] ${e.description}`).join("\n")}` : "",
          r.criticalErrors.length ? `ERRORES GRAVES PREVISTOS:\n${r.criticalErrors.map((e) => `- [${e.id}] ${e.description} (tag: ${e.tag})`).join("\n")}` : "",
          ctx.knownMisconceptions.length ? `ERRORES QUE ESTE ESTUDIANTE YA COMETIÓ ANTES (comprueba si persisten): ${ctx.knownMisconceptions.join("; ")}` : "",
          r.optionalElements.length ? `ELEMENTOS OPCIONALES (no penalizar si faltan): ${r.optionalElements.join("; ")}` : "",
          `RESPUESTA MODELO: ${r.referenceAnswer}`,
          `AFIRMACIONES VALIDADAS DE REFERENCIA:\n${ctx.referenceClaims.map((c) => `- ${c.text}`).join("\n")}`,
          `CONCEPTOS DEL TEMA: ${ctx.topicConcepts.map((c) => c.name).join("; ")}`,
          `NIVEL DE LA PRÓXIMA PISTA: ${ctx.nextHintLevel} (1 general, 2 concepto relevante, 3 mecanismo/pasos que faltan)`,
          `RESPUESTA DEL ESTUDIANTE:\n"""\n${ctx.answer.slice(0, 6000)}\n"""`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: semanticEvalSchema,
  });
  return toResult(r, res.data, ctx.topicConcepts);
}

export function toResult(r: Rubric, d: SemanticEval, topicConcepts: { id: string; name: string }[]): EvaluationResult {
  const all = [...r.essentialElements, ...r.relations];
  const statuses = new Map<string, ElementStatus>();
  for (const e of d.elements) if (all.some((x) => x.id === e.id)) statuses.set(e.id, e.status);
  const knownTags = new Map(r.criticalErrors.map((c) => [c.id, c.tag]));
  const criticalErrors = d.criticalErrors.map((c) => ({
    tag: (c.rubricId && knownTags.get(c.rubricId)) || c.tag || "error-conceptual",
    description: c.description,
  }));
  const score = scoreFromElements(r, statuses, criticalErrors.length, d.ambiguous);
  const label = new Map(all.map((e) => [e.id, e.description]));
  const byNorm = new Map(topicConcepts.map((c) => [normalize(c.name), c.id]));
  return {
    score,
    verdict: d.ambiguous ? "AMBIGUOUS" : verdictFor(score),
    elements: all.map((e) => {
      const ev = d.elements.find((x) => x.id === e.id);
      return { id: e.id, label: e.description, status: statuses.get(e.id) ?? "ABSENT", note: ev?.note || undefined };
    }),
    correct: all.filter((e) => statuses.get(e.id) === "PRESENT").map((e) => e.description),
    incorrect: [
      ...all.filter((e) => statuses.get(e.id) === "INCORRECT").map((e) => ({ description: `${label.get(e.id)}: incorrecto`, explanation: d.elements.find((x) => x.id === e.id)?.note })),
      ...d.incorrectStatements.map((s) => ({ description: s.statement, explanation: s.explanation })),
    ],
    missing: all.filter((e) => (statuses.get(e.id) ?? "ABSENT") === "ABSENT").map((e) => e.description),
    criticalErrors,
    ambiguityNote: d.ambiguous ? d.ambiguityNote : undefined,
    feedback: d.feedback,
    hint: d.nextHint || undefined,
    explanation: d.explanation || r.explanation,
    references: [],
    nextRecommendation: d.nextRecommendation || undefined,
    confusedWithConceptIds: d.confusedWithConcepts.map((n) => byNorm.get(normalize(n))).filter((x): x is string => !!x),
  };
}

/**
 * Evaluación PROVISIONAL cuando la IA no está disponible: solo comprueba la presencia de
 * términos clave. Se marca como provisional, pesa menos en el dominio y se reevalúa después.
 */
export function heuristicEvaluate(r: Rubric, answer: string): EvaluationResult {
  const text = ` ${normalize(answer)} `;
  const all = [...r.essentialElements, ...r.relations];
  const statuses = new Map<string, ElementStatus>();
  let evaluable = 0;
  for (const e of all) {
    if (!e.keyTerms.length) continue;
    evaluable++;
    const hit = e.keyTerms.some((t) => {
      const n = normalize(t);
      if (!n) return false;
      if (text.includes(` ${n} `) || text.includes(` ${n}`)) return true;
      const stem = n.length > 6 ? n.slice(0, Math.max(5, n.length - 3)) : null;
      return stem ? text.includes(` ${stem}`) : false;
    });
    statuses.set(e.id, hit ? "PRESENT" : "ABSENT");
  }
  const evaluableEls = all.filter((e) => e.keyTerms.length);
  const total = evaluableEls.reduce((a, e) => a + e.weight, 0);
  const got = evaluableEls.reduce((a, e) => a + (statuses.get(e.id) === "PRESENT" ? e.weight : 0), 0);
  const score = total ? Math.round((got / total) * 100) / 100 : 0;
  return {
    score,
    verdict: verdictFor(score),
    elements: all.map((e) => ({ id: e.id, label: e.description, status: statuses.get(e.id) ?? "ABSENT", note: e.keyTerms.length ? undefined : "No evaluable sin IA" })),
    correct: evaluableEls.filter((e) => statuses.get(e.id) === "PRESENT").map((e) => e.description),
    incorrect: [],
    missing: evaluableEls.filter((e) => statuses.get(e.id) !== "PRESENT").map((e) => e.description),
    criticalErrors: [],
    feedback:
      `Evaluación provisional (la IA no está disponible): solo se ha comprobado la presencia de términos clave` +
      (evaluable < all.length ? ` en ${evaluable} de ${all.length} aspectos` : "") +
      `. No valora si las relaciones son correctas. Se reevaluará automáticamente cuando la IA vuelva a estar disponible.`,
    references: [],
    confusedWithConceptIds: [],
    explanation: r.explanation,
  };
}
