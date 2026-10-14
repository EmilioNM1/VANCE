import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/db/client";
import { activities, chunks, claims, conceptClaims, conceptRelations, concepts, type ActivityType } from "@/db/schema";
import type { ActivityPayload, ConceptDetails, Rubric, RubricElement } from "@/lib/types";
import { aiConfigured, aiStructured } from "../ai";

type ConceptRow = typeof concepts.$inferSelect;
type ActivityInsert = typeof activities.$inferInsert;
export interface SourceClaim {
  id: string;
  text: string;
  chunkId: string;
}

// ───────────────────────────── Selección del tipo de actividad ─────────────────────────────

/**
 * Elige los tipos de actividad que mejor se adaptan a la naturaleza del concepto.
 * Los tipos abiertos (recuerdo libre, explicación, predicción, caso) son el núcleo;
 * el reconocimiento es solo complementario.
 */
export function selectActivityTypes(c: { kind: ConceptRow["kind"]; details: ConceptDetails }, hasRelations: boolean): ActivityType[] {
  const steps = c.details.steps?.length ?? 0;
  const t: ActivityType[] = [];
  switch (c.kind) {
    case "PROCESS":
      t.push("FREE_RECALL");
      if (steps >= 3) t.push("PROCESS_ORDER");
      t.push("PREDICTION");
      break;
    case "MECHANISM":
      t.push("EXPLAIN");
      if (steps >= 3) t.push("PROCESS_ORDER");
      t.push("PREDICTION", "CASE");
      break;
    case "FORMULA":
      t.push("FREE_RECALL", "CLOZE", "CASE");
      break;
    case "CLASSIFICATION":
    case "COMPARISON":
      t.push("FREE_RECALL", "RELATION");
      break;
    case "STRUCTURE":
      t.push("FREE_RECALL", "RELATION");
      break;
    default:
      t.push("FREE_RECALL", "CLOZE");
      if (c.details.applications?.length) t.push("CASE");
  }
  if (hasRelations && !t.includes("RELATION")) t.push("RELATION");
  if (c.kind !== "PROCESS" && c.kind !== "MECHANISM" && !t.includes("EXPLAIN") && steps >= 2) t.push("EXPLAIN");
  t.push("RECOGNITION");
  return [...new Set(t)];
}

export const AI_TYPES: ActivityType[] = ["FREE_RECALL", "EXPLAIN", "PREDICTION", "CASE", "RELATION"];

// ───────────────────────────── Constructores deterministas ─────────────────────────────

function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  // Garantiza que no quede en el orden correcto
  if (a.every((x, i) => x === arr[i]) && a.length > 1) a.push(a.shift()!);
  return a;
}

export function buildProcessOrder(concept: Pick<ConceptRow, "id" | "name" | "details">, claimChunk: Map<string, string>): Omit<ActivityInsert, "userId" | "documentId"> | null {
  const steps = concept.details.steps ?? [];
  if (steps.length < 3) return null;
  const items = steps.map((s, i) => ({ id: `s${i + 1}`, text: s.text }));
  const claimIds = [...new Set(steps.flatMap((s) => s.claimIds))];
  const rubric: Rubric = {
    referenceAnswer: steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n"),
    essentialElements: steps.map((s, i) => ({ id: `s${i + 1}`, description: `Paso ${i + 1}`, keyTerms: [], weight: 1, claimIds: s.claimIds })),
    relations: [],
    criticalErrors: [],
    optionalElements: [],
    precision: "EXACT",
    hints: [
      "Piensa en qué desencadena todo el proceso: ¿cuál es el estímulo inicial?",
      "Cada paso produce la condición necesaria para el siguiente. Busca el que depende de los demás y colócalo al final.",
      `Recuerda que el proceso empieza con: «${steps[0]!.text}».`,
    ],
    explanation: `El orden correcto de «${concept.name}» es:\n${steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}`,
  };
  return {
    conceptId: concept.id,
    type: "PROCESS_ORDER",
    prompt: `Reconstruye en orden el proceso: ${concept.name}. Después explica por qué cada paso conduce al siguiente.`,
    payload: {
      items: seededShuffle(items, concept.id),
      askJustification: true,
      instructions: "Arrastra los pasos (o usa los botones ↑ ↓) hasta dejarlos en el orden correcto. Sin consultar el material.",
    },
    answerKey: { order: items.map((i) => i.id) },
    rubric,
    claimIds,
    chunkIds: [...new Set(claimIds.map((c) => claimChunk.get(c)).filter((x): x is string => !!x))],
    generatedBy: "RULES",
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Oculta términos clave dentro de una afirmación validada (completar huecos). */
export function buildCloze(concept: Pick<ConceptRow, "id" | "name" | "details">, sourceClaims: SourceClaim[]): Omit<ActivityInsert, "userId" | "documentId"> | null {
  const terms = [concept.name, ...(concept.details.keyTerms ?? [])]
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && t.length <= 60)
    .sort((a, b) => b.length - a.length);
  // Elige la afirmación con más términos ocultables
  let best: { claim: SourceClaim; hits: string[] } | null = null;
  for (const c of sourceClaims) {
    const hits = terms.filter((t) => new RegExp(`(^|[^\\p{L}])${escapeRe(t)}(?=$|[^\\p{L}])`, "iu").test(c.text));
    if (hits.length && (!best || hits.length > best.hits.length)) best = { claim: c, hits };
  }
  if (!best || best.claim.text.length < 25) return null;
  let text = best.claim.text;
  const blanks: Record<string, { answer: string; accept: string[] }> = {};
  const marks: string[] = [];
  for (const t of best.hits.slice(0, 3)) {
    const re = new RegExp(`(^|[^\\p{L}])(${escapeRe(t)})(?=$|[^\\p{L}])`, "iu");
    const m = text.match(re);
    if (!m) continue;
    const id = `b${marks.length + 1}`;
    blanks[id] = { answer: m[2]!, accept: [] };
    marks.push(id);
    text = text.replace(re, `$1\u0000${id}\u0000`);
  }
  if (!marks.length) return null;
  const segments: NonNullable<ActivityPayload["segments"]> = [];
  for (const part of text.split("\u0000")) {
    if (blanks[part]) segments.push({ type: "blank", id: part, length: blanks[part]!.answer.length });
    else if (part) segments.push({ type: "text", text: part });
  }
  const answers = marks.map((m) => blanks[m]!.answer);
  return {
    conceptId: concept.id,
    type: "CLOZE",
    // El enunciado no nombra el concepto si es uno de los huecos (sería dar la respuesta)
    prompt: answers.some((a) => a.toLowerCase() === concept.name.toLowerCase())
      ? "Completa la información que falta sin consultar el material."
      : `Completa la información que falta sobre «${concept.name}» sin consultar el material.`,
    payload: { segments, instructions: "Escribe en cada hueco el término que falta." },
    answerKey: { blanks },
    rubric: {
      referenceAnswer: best.claim.text,
      essentialElements: marks.map((m, i) => ({ id: m, description: `Hueco ${i + 1}`, keyTerms: [blanks[m]!.answer], weight: 1, claimIds: [best!.claim.id] })),
      relations: [],
      criticalErrors: [],
      optionalElements: [],
      precision: "EXACT",
      hints: [
        "Relee la frase completa y piensa de qué estructura o proceso está hablando.",
        `El término ${answers.length > 1 ? "de cada hueco" : "que falta"} está directamente relacionado con «${concept.name}».`,
        `Pistas de inicio: ${answers.map((a) => `«${a.slice(0, 2)}…» (${a.length} letras)`).join(", ")}.`,
      ],
      explanation: best.claim.text,
    },
    claimIds: [best.claim.id],
    chunkIds: [best.claim.chunkId],
    generatedBy: "RULES",
  };
}

/** Reconocimiento (opción múltiple) — solo complementario: nunca basta para dar un concepto por dominado. */
export function buildRecognition(
  concept: Pick<ConceptRow, "id" | "name" | "summary" | "kind">,
  others: Pick<ConceptRow, "id" | "name" | "kind">[],
  sourceClaims: SourceClaim[],
): Omit<ActivityInsert, "userId" | "documentId"> | null {
  const distractors = [...others.filter((o) => o.kind === concept.kind), ...others.filter((o) => o.kind !== concept.kind)]
    .filter((o) => o.id !== concept.id)
    .slice(0, 3);
  if (distractors.length < 2 || !sourceClaims.length) return null;
  const masked = concept.summary.replace(new RegExp(escapeRe(concept.name), "gi"), "____");
  const options = seededShuffle(
    [concept, ...distractors].map((c, i) => ({ id: `o${i + 1}`, text: c.name, conceptId: c.id })),
    concept.id + "r",
  );
  const correct = options.find((o) => o.conceptId === concept.id)!;
  return {
    conceptId: concept.id,
    relatedConceptIds: distractors.map((d) => d.id),
    type: "RECOGNITION",
    prompt: `¿A qué concepto corresponde esta descripción?\n\n«${masked}»`,
    payload: { options: options.map(({ id, text }) => ({ id, text })), instructions: "Elige una opción. Después se te pedirá explicarlo sin opciones." },
    answerKey: { correctOptionId: correct.id, optionConceptIds: Object.fromEntries(options.map((o) => [o.id, o.conceptId])) },
    rubric: {
      referenceAnswer: concept.name,
      essentialElements: [{ id: "e1", description: "Identificación del concepto", keyTerms: [concept.name], weight: 1, claimIds: sourceClaims.slice(0, 2).map((c) => c.id) }],
      relations: [],
      criticalErrors: [],
      optionalElements: [],
      precision: "EXACT",
      hints: ["Fíjate en la función que se describe.", "Descarta las opciones que pertenecen a otro nivel (estructura, proceso, molécula…).", "Piensa en qué concepto del tema cumple exactamente ese papel."],
      explanation: `La descripción corresponde a «${concept.name}»: ${concept.summary}`,
    },
    claimIds: sourceClaims.slice(0, 2).map((c) => c.id),
    chunkIds: [...new Set(sourceClaims.slice(0, 2).map((c) => c.chunkId))],
    generatedBy: "RULES",
  };
}

// ───────────────────────────── Generación con IA (actividades abiertas) ─────────────────────────────

const elementSchema = z.object({ description: z.string(), keyTerms: z.array(z.string()), weight: z.number(), claimRefs: z.array(z.string()) });

export const generatedActivitiesSchema = z.object({
  activities: z.array(
    z.object({
      conceptKey: z.string(),
      type: z.enum(["FREE_RECALL", "EXPLAIN", "PREDICTION", "CASE", "RELATION"]),
      prompt: z.string(),
      scenario: z.string().nullable(),
      relatedConceptKeys: z.array(z.string()),
      referenceAnswer: z.string(),
      essentialElements: z.array(elementSchema),
      relationElements: z.array(elementSchema),
      criticalErrors: z.array(z.object({ description: z.string(), tag: z.string() })),
      optionalElements: z.array(z.string()),
      precision: z.enum(["CONCEPTUAL", "EXACT"]),
      hints: z.array(z.string()),
      explanation: z.string(),
      claimRefs: z.array(z.string()),
    }),
  ),
});

type GeneratedActivity = z.infer<typeof generatedActivitiesSchema>["activities"][number];

const GEN_SYSTEM = `Diseñas actividades de RECUERDO ACTIVO (no cuestionarios) a partir de conceptos con afirmaciones validadas (C#).
Tipos:
- FREE_RECALL: pide recuperar de memoria el concepto/proceso completo, sin pistas en el enunciado.
- EXPLAIN: "explícalo como si se lo enseñaras a un compañero", exigiendo mecanismos y relaciones, no solo la definición.
- PREDICTION: plantea un cambio hipotético (bloquear, eliminar, aumentar un elemento) y pide predecir y justificar consecuencias.
- CASE: situación nueva y distinta de los ejemplos del texto (en "scenario") donde hay que aplicar el conocimiento.
- RELATION: pide explicar cómo se relacionan dos o más conceptos y qué pasaría si uno cambiara.
Reglas:
- El enunciado NUNCA debe contener la respuesta ni pistas obvias.
- La respuesta correcta debe poder deducirse SOLO de las afirmaciones C# proporcionadas (en PREDICTION/CASE se permite razonar a partir de ellas, sin hechos nuevos).
- Rúbrica: "essentialElements" (2-6) con "description" redactada como ASPECTO a evaluar que NO revele la respuesta (p. ej. "Papel del ion que desencadena la unión", no "El calcio se une a la troponina C"), "keyTerms" con términos y sinónimos aceptables, "weight" 1-3, "claimRefs" obligatorios.
- "relationElements": relaciones causa-efecto o secuencia que deben aparecer (mismo formato).
- "criticalErrors": errores conceptuales graves plausibles, con "tag" corto en kebab-case estable (p. ej. "calcio-se-une-a-tropomiosina"). Usa los errores frecuentes del concepto cuando existan.
- "hints": EXACTAMENTE 3 pistas progresivas: 1) general/orientativa, 2) sobre el concepto relevante, 3) sobre el mecanismo o los pasos que faltan. Ninguna debe dar la respuesta completa.
- "explanation": explicación completa y didáctica (nivel 4).
- "referenceAnswer": respuesta modelo concisa.
- Escribe en el idioma de las afirmaciones.`;

/** Valida una actividad generada por la IA: sin respaldo válido, se rechaza. Función pura. */
export function validateGeneratedActivity(
  a: GeneratedActivity,
  ctx: { conceptId: string; refToClaim: Map<string, SourceClaim>; keyToConceptId: Map<string, string> },
): { ok: true; activity: Omit<ActivityInsert, "userId" | "documentId"> } | { ok: false; reason: string } {
  const resolve = (refs: string[]) => [...new Set(refs.map((r) => ctx.refToClaim.get(r.trim())?.id).filter((x): x is string => !!x))];
  const toEl = (prefix: string) => (e: z.infer<typeof elementSchema>, i: number): RubricElement | null => {
    const ids = resolve(e.claimRefs);
    if (!ids.length || !e.description.trim()) return null;
    return { id: `${prefix}${i + 1}`, description: e.description.trim(), keyTerms: e.keyTerms.filter(Boolean), weight: Math.min(3, Math.max(1, Math.round(e.weight || 1))), claimIds: ids };
  };
  const essential = a.essentialElements.map(toEl("e")).filter((x): x is RubricElement => !!x);
  const relations = a.relationElements.map(toEl("r")).filter((x): x is RubricElement => !!x);
  const claimIds = [...new Set([...resolve(a.claimRefs), ...essential.flatMap((e) => e.claimIds), ...relations.flatMap((e) => e.claimIds)])];
  if (!claimIds.length) return { ok: false, reason: "La actividad no cita ninguna afirmación validada." };
  if (!essential.length) return { ok: false, reason: "La rúbrica no tiene elementos esenciales respaldados." };
  if (!a.prompt.trim() || !a.referenceAnswer.trim()) return { ok: false, reason: "Enunciado o respuesta modelo vacíos." };
  if (a.hints.length < 3) return { ok: false, reason: "Faltan pistas progresivas." };
  if (a.type === "CASE" && !a.scenario?.trim()) return { ok: false, reason: "El caso no tiene escenario." };
  const related = a.relatedConceptKeys.map((k) => ctx.keyToConceptId.get(k)).filter((x): x is string => !!x && x !== ctx.conceptId);
  const chunkIds = [...new Set(claimIds.map((id) => [...ctx.refToClaim.values()].find((c) => c.id === id)?.chunkId).filter((x): x is string => !!x))];
  const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return {
    ok: true,
    activity: {
      conceptId: ctx.conceptId,
      relatedConceptIds: [...new Set(related)],
      type: a.type,
      prompt: a.prompt.trim(),
      payload: { scenario: a.scenario?.trim() || undefined, minWords: a.type === "EXPLAIN" ? 40 : undefined },
      answerKey: {},
      rubric: {
        referenceAnswer: a.referenceAnswer.trim(),
        essentialElements: essential,
        relations,
        criticalErrors: a.criticalErrors.filter((e) => e.description.trim()).map((e, i) => ({ id: `x${i + 1}`, description: e.description.trim(), tag: slug(e.tag || e.description) })),
        optionalElements: a.optionalElements,
        precision: a.precision,
        hints: [a.hints[0]!, a.hints[1]!, a.hints[2]!],
        explanation: a.explanation.trim() || a.referenceAnswer.trim(),
      },
      claimIds,
      chunkIds,
      generatedBy: "AI",
    },
  };
}

// ───────────────────────────── Orquestación ─────────────────────────────

export async function generateActivitiesForDocument(userId: string, documentId: string): Promise<{ created: number; rejected: number }> {
  const data = await withUser(userId, async (tx) => {
    const cs = await tx.select().from(concepts).where(eq(concepts.documentId, documentId));
    const links = cs.length
      ? await tx
          .select({ conceptId: conceptClaims.conceptId, id: claims.id, text: claims.finalText, chunkId: claims.chunkId, validated: claims.validated })
          .from(conceptClaims)
          .innerJoin(claims, eq(claims.id, conceptClaims.claimId))
          .where(inArray(conceptClaims.conceptId, cs.map((c) => c.id)))
      : [];
    const rels = await tx.select().from(conceptRelations).where(eq(conceptRelations.documentId, documentId));
    await tx.delete(activities).where(eq(activities.documentId, documentId));
    return { cs, links: links.filter((l) => l.validated && l.text), rels };
  });
  const claimsByConcept = new Map<string, SourceClaim[]>();
  for (const l of data.links) claimsByConcept.set(l.conceptId, [...(claimsByConcept.get(l.conceptId) ?? []), { id: l.id, text: l.text!, chunkId: l.chunkId }]);
  const claimChunk = new Map(data.links.map((l) => [l.id, l.chunkId]));
  const relCount = new Map<string, number>();
  for (const r of data.rels) {
    relCount.set(r.fromConceptId, (relCount.get(r.fromConceptId) ?? 0) + 1);
    relCount.set(r.toConceptId, (relCount.get(r.toConceptId) ?? 0) + 1);
  }

  const toInsert: Omit<ActivityInsert, "userId" | "documentId">[] = [];
  let rejected = 0;
  const aiWork: { concept: ConceptRow; types: ActivityType[] }[] = [];
  for (const c of data.cs) {
    const src = claimsByConcept.get(c.id) ?? [];
    if (!src.length) continue; // sin fuente válida no se genera nada
    const types = selectActivityTypes(c, (relCount.get(c.id) ?? 0) > 0);
    if (types.includes("PROCESS_ORDER")) {
      const a = buildProcessOrder(c, claimChunk);
      if (a) toInsert.push(a);
    }
    if (types.includes("CLOZE")) {
      const a = buildCloze(c, src);
      if (a) toInsert.push(a);
    }
    if (types.includes("RECOGNITION")) {
      const a = buildRecognition(c, data.cs, src);
      if (a) toInsert.push(a);
    }
    const aiTypes = types.filter((t) => AI_TYPES.includes(t)).slice(0, c.importance >= 3 ? 4 : 3);
    if (aiTypes.length) aiWork.push({ concept: c, types: aiTypes });
  }

  if (aiConfigured()) {
    const nameById = new Map(data.cs.map((c) => [c.id, c.name]));
    for (let i = 0; i < aiWork.length; i += 4) {
      const batch = aiWork.slice(i, i + 4);
      const refToClaim = new Map<string, SourceClaim>();
      const keyToConceptId = new Map<string, string>();
      let n = 0;
      const blocks = batch.map((w, k) => {
        const key = `K${k + 1}`;
        keyToConceptId.set(key, w.concept.id);
        const src = claimsByConcept.get(w.concept.id) ?? [];
        // Incluye afirmaciones de conceptos relacionados para actividades de relación
        const relatedIds = data.rels
          .filter((r) => r.fromConceptId === w.concept.id || r.toConceptId === w.concept.id)
          .map((r) => (r.fromConceptId === w.concept.id ? r.toConceptId : r.fromConceptId))
          .slice(0, 3);
        const relatedLines = relatedIds.map((rid, j) => {
          const rk = `${key}R${j + 1}`;
          keyToConceptId.set(rk, rid);
          const rc = (claimsByConcept.get(rid) ?? []).slice(0, 3);
          return `  Relacionado [${rk}] ${nameById.get(rid)}:\n${rc
            .map((c) => {
              const ref = `C${++n}`;
              refToClaim.set(ref, c);
              return `    [${ref}] ${c.text}`;
            })
            .join("\n")}`;
        });
        const own = src
          .map((c) => {
            const ref = `C${++n}`;
            refToClaim.set(ref, c);
            return `  [${ref}] ${c.text}`;
          })
          .join("\n");
        const d = w.concept.details;
        return (
          `[${key}] ${w.concept.name} (${w.concept.kind}) — genera: ${w.types.join(", ")}\n` +
          `  Resumen: ${w.concept.summary}\n` +
          (d.misconceptions?.length ? `  Errores frecuentes: ${d.misconceptions.join("; ")}\n` : "") +
          `  Afirmaciones validadas:\n${own}\n${relatedLines.join("\n")}`
        );
      });
      try {
        const res = await aiStructured({
          operation: "activities.generate",
          userId,
          effort: "medium",
          system: GEN_SYSTEM,
          content: [{ type: "text", text: blocks.join("\n\n") }],
          schema: generatedActivitiesSchema,
        });
        for (const a of res.data.activities) {
          const conceptId = keyToConceptId.get(a.conceptKey);
          if (!conceptId || !batch.some((w) => w.concept.id === conceptId)) {
            rejected++;
            continue;
          }
          const v = validateGeneratedActivity(a, { conceptId, refToClaim, keyToConceptId });
          if (v.ok) toInsert.push(v.activity);
          else rejected++;
        }
      } catch (e) {
        console.warn("[activities] lote no generado:", e instanceof Error ? e.message : e);
      }
    }
  }

  if (toInsert.length)
    await withUser(userId, (tx) => tx.insert(activities).values(toInsert.map((a) => ({ ...a, userId, documentId }))));
  return { created: toInsert.length, rejected };
}

/** Comprueba que una actividad sigue respaldada por afirmaciones validadas. */
export async function activityHasValidSource(userId: string, activityId: string) {
  return withUser(userId, async (tx) => {
    const [a] = await tx.select().from(activities).where(eq(activities.id, activityId));
    if (!a || !a.claimIds.length) return false;
    const valid = await tx.select({ id: claims.id }).from(claims).where(and(inArray(claims.id, a.claimIds), eq(claims.validated, true)));
    const ch = await tx.select({ id: chunks.id }).from(chunks).where(inArray(chunks.id, a.chunkIds.length ? a.chunkIds : ["00000000-0000-0000-0000-000000000000"]));
    return valid.length > 0 && ch.length > 0;
  });
}
