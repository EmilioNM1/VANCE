import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/db/client";
import { chunks, claims, conceptClaims, conceptRelations, concepts, documents, notebookPages, sections, type ConceptKind, type RelationType } from "@/db/schema";
import type { ConceptDetails } from "@/lib/types";
import { aiStructured } from "../ai";
import { AiUnavailableError } from "../ai/errors";
import { PermanentJobError, type JobRow } from "../jobs/queue";
import { setDocumentStatus } from "../documents/service";
import { generateActivitiesForDocument } from "../activities/generate";

const CONCEPT_KINDS = ["CONCEPT", "DEFINITION", "PROCESS", "MECHANISM", "STRUCTURE", "CLASSIFICATION", "FORMULA", "COMPARISON", "FACT"] as const;
const RELATION_TYPES = ["CAUSES", "ENABLES", "INHIBITS", "PART_OF", "IS_A", "PRECEDES", "PREREQUISITE_OF", "REGULATES", "CONTRASTS_WITH", "EXAMPLE_OF", "RELATED_TO"] as const;

const relationSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(RELATION_TYPES),
  description: z.string(),
  claimRefs: z.array(z.string()),
});

export const knowledgeSchema = z.object({
  concepts: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      kind: z.enum(CONCEPT_KINDS),
      summary: z.string(),
      importance: z.number(),
      claimRefs: z.array(z.string()),
      keyTerms: z.array(z.string()),
      steps: z.array(z.object({ text: z.string(), claimRefs: z.array(z.string()) })),
      formula: z.object({ expression: z.string(), variables: z.array(z.object({ symbol: z.string(), meaning: z.string() })) }).nullable(),
      components: z.array(z.string()),
      examples: z.array(z.string()),
      exceptions: z.array(z.string()),
      misconceptions: z.array(z.string()),
      applications: z.array(z.string()),
    }),
  ),
  relations: z.array(relationSchema),
});

export const globalRelationsSchema = z.object({ relations: z.array(relationSchema) });

export const KNOWLEDGE_SYSTEM = `Eres un experto en ciencias cognitivas y diseño instruccional. Transformas afirmaciones VALIDADAS (C1, C2…) de un material de estudio en una estructura de conocimiento.
Identifica conceptos, definiciones, procesos secuenciales, mecanismos, estructuras, clasificaciones, fórmulas, comparaciones, causas/consecuencias y prerrequisitos.
Reglas estrictas:
- Usa EXCLUSIVAMENTE la información de las afirmaciones proporcionadas. No añadas hechos externos.
- Cada concepto debe citar en claimRefs las afirmaciones que lo justifican (al menos una).
- Para PROCESS y MECHANISM, describe los pasos en orden en "steps", cada uno con sus claimRefs. Un paso sin respaldo no debe incluirse.
- Agrupa: no crees un concepto por cada afirmación; un mecanismo (p. ej. acoplamiento excitación-contracción) es UN concepto con varios pasos, y sus piezas importantes (p. ej. troponina) pueden ser conceptos propios relacionados.
- "misconceptions": errores conceptuales frecuentes de estudiantes sobre este concepto (pueden venir de tu experiencia docente; se usan solo para detectar errores, nunca como contenido a aprender).
- Relaciones: from/to son "key" de conceptos; incluye claimRefs que las justifiquen. Usa PREREQUISITE_OF cuando entender A sea necesario para entender B.
- importance: 1 (detalle), 2 (importante), 3 (central).
- Escribe en el idioma de las afirmaciones.`;

type ClaimLite = { id: string; text: string; sectionId: string | null; chunkId: string | null };

export interface CleanConcept {
  key: string;
  name: string;
  kind: ConceptKind;
  summary: string;
  importance: number;
  claimIds: string[];
  details: ConceptDetails;
}
export interface CleanRelation {
  fromKey: string;
  toKey: string;
  type: RelationType;
  description: string;
  claimIds: string[];
}

/**
 * Valida la salida del modelo: descarta conceptos, pasos y relaciones sin respaldo en
 * afirmaciones validadas. Función pura (probada en tests/unit).
 */
export function validateKnowledge(data: z.infer<typeof knowledgeSchema>, refToClaimId: Map<string, string>) {
  const resolve = (refs: string[]) => [...new Set(refs.map((r) => refToClaimId.get(r.trim())).filter((x): x is string => !!x))];
  const dropped: string[] = [];
  const out: CleanConcept[] = [];
  const keys = new Set<string>();
  for (const c of data.concepts) {
    const claimIds = resolve(c.claimRefs);
    const steps = c.steps.map((s) => ({ text: s.text.trim(), claimIds: resolve(s.claimRefs) })).filter((s) => s.text && s.claimIds.length);
    const allClaims = [...new Set([...claimIds, ...steps.flatMap((s) => s.claimIds)])];
    if (!allClaims.length || !c.name.trim()) {
      dropped.push(`Concepto «${c.name}» descartado: sin afirmaciones validadas que lo respalden.`);
      continue;
    }
    if (keys.has(c.key)) continue;
    keys.add(c.key);
    out.push({
      key: c.key,
      name: c.name.trim().slice(0, 200),
      kind: c.kind,
      summary: c.summary.trim(),
      importance: Math.min(3, Math.max(1, Math.round(c.importance || 2))),
      claimIds: allClaims,
      details: {
        keyTerms: c.keyTerms.filter(Boolean).slice(0, 12),
        steps: steps.length ? steps : undefined,
        formula: c.formula ?? undefined,
        components: c.components.length ? c.components : undefined,
        examples: c.examples.length ? c.examples : undefined,
        exceptions: c.exceptions.length ? c.exceptions : undefined,
        misconceptions: c.misconceptions.length ? c.misconceptions : undefined,
        applications: c.applications.length ? c.applications : undefined,
      },
    });
  }
  const relations: CleanRelation[] = [];
  for (const r of data.relations) {
    const claimIds = resolve(r.claimRefs);
    if (!keys.has(r.from) || !keys.has(r.to) || r.from === r.to) continue;
    if (!claimIds.length) {
      dropped.push(`Relación ${r.from}→${r.to} descartada: sin respaldo.`);
      continue;
    }
    relations.push({ fromKey: r.from, toKey: r.to, type: r.type, description: r.description.trim(), claimIds });
  }
  return { concepts: out, relations, dropped };
}

export const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export async function handleBuildKnowledge(job: JobRow) {
  const { documentId } = job.payload as { documentId: string };
  const userId = job.userId!;
  const loaded = await withUser(userId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return null;
    const rows = await tx
      .select({ id: claims.id, text: claims.finalText, sectionId: chunks.sectionId, chunkId: claims.chunkId })
      .from(claims)
      .innerJoin(chunks, eq(chunks.id, claims.chunkId))
      .where(and(eq(claims.documentId, documentId), eq(claims.validated, true)))
      .orderBy(asc(claims.ord));
    const secs = await tx.select().from(sections).where(eq(sections.documentId, documentId)).orderBy(asc(sections.ord));
    return { doc, claims: rows.filter((r) => r.text) as ClaimLite[], secs };
  });
  if (!loaded) return;
  const { doc, secs } = loaded;
  if (!loaded.claims.length) {
    await setDocumentStatus(userId, documentId, "REVIEW", null, { error: "No hay afirmaciones validadas para construir el conocimiento.", errorCode: "NO_VALID_CLAIMS" });
    throw new PermanentJobError("sin afirmaciones validadas");
  }
  try {
    await withUser(userId, (tx) => tx.delete(concepts).where(eq(concepts.documentId, documentId)));

    // Agrupa afirmaciones por sección en lotes de ≤ 70
    const bySection = new Map<string, ClaimLite[]>();
    for (const c of loaded.claims) bySection.set(c.sectionId ?? "", [...(bySection.get(c.sectionId ?? "") ?? []), c]);
    const batches: { sectionIds: string[]; title: string; claims: ClaimLite[] }[] = [];
    for (const s of [...secs.map((s) => s.id), ""]) {
      const list = bySection.get(s);
      if (!list?.length) continue;
      const title = secs.find((x) => x.id === s)?.title ?? doc.title;
      const last = batches[batches.length - 1];
      if (last && last.claims.length + list.length <= 70 && list.length < 25) {
        last.claims.push(...list);
        last.sectionIds.push(s);
        last.title += ` / ${title}`;
      } else {
        for (let i = 0; i < list.length; i += 70) batches.push({ sectionIds: [s], title, claims: list.slice(i, i + 70) });
      }
    }

    const nameToConcept = new Map<string, { id: string; name: string; claimIds: Set<string> }>();
    const conceptClaimText = new Map<string, string[]>();
    const claimText = new Map(loaded.claims.map((c) => [c.id, c.text]));
    let droppedTotal = 0;

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b]!;
      await setDocumentStatus(userId, documentId, "BUILDING_KNOWLEDGE", `Construyendo el mapa de conocimiento: parte ${b + 1} de ${batches.length}`);
      const refMap = new Map(batch.claims.map((c, i) => [`C${i + 1}`, c.id]));
      const res = await aiStructured({
        operation: "knowledge.build",
        cache: true,
        userId,
        effort: "medium",
        system: KNOWLEDGE_SYSTEM,
        content: [
          {
            type: "text",
            text: `Documento: «${doc.title}» — Sección(es): ${batch.title}\n\nAFIRMACIONES VALIDADAS:\n${batch.claims.map((c, i) => `[C${i + 1}] ${c.text}`).join("\n")}`,
          },
        ],
        schema: knowledgeSchema,
      });
      const clean = validateKnowledge(res.data, refMap);
      droppedTotal += clean.dropped.length;
      const sectionId = batch.sectionIds.find((s) => s) ?? null;

      await withUser(userId, async (tx) => {
        const keyToId = new Map<string, string>();
        for (const c of clean.concepts) {
          const existing = nameToConcept.get(normName(c.name));
          let cid: string;
          if (existing) {
            cid = existing.id;
          } else {
            const [row] = await tx
              .insert(concepts)
              .values({ userId, documentId, sectionId, name: c.name, kind: c.kind, summary: c.summary, details: c.details, importance: c.importance })
              .returning({ id: concepts.id });
            cid = row!.id;
            nameToConcept.set(normName(c.name), { id: cid, name: c.name, claimIds: new Set() });
          }
          keyToId.set(c.key, cid);
          const entry = nameToConcept.get(normName(c.name))!;
          const newIds = c.claimIds.filter((id) => !entry.claimIds.has(id));
          newIds.forEach((id) => entry.claimIds.add(id));
          if (newIds.length) await tx.insert(conceptClaims).values(newIds.map((claimId) => ({ userId, conceptId: cid, claimId }))).onConflictDoNothing();
          conceptClaimText.set(cid, [...entry.claimIds].map((id) => claimText.get(id)!).filter(Boolean));
        }
        for (const r of clean.relations) {
          await tx.insert(conceptRelations).values({
            userId,
            documentId,
            fromConceptId: keyToId.get(r.fromKey)!,
            toConceptId: keyToId.get(r.toKey)!,
            type: r.type,
            description: r.description,
            claimIds: r.claimIds,
          });
        }
      });
    }

    // Relaciones entre partes del documento (solo si hubo varios lotes)
    if (batches.length > 1 && nameToConcept.size > 1) {
      await setDocumentStatus(userId, documentId, "BUILDING_KNOWLEDGE", "Relacionando conceptos entre capítulos");
      const list = [...nameToConcept.values()].slice(0, 120);
      const keyMap = new Map(list.map((c, i) => [`K${i + 1}`, c]));
      const claimRefs = new Map<string, string>();
      let n = 0;
      const text = list
        .map((c, i) => {
          const lines = [...c.claimIds].slice(0, 4).map((id) => {
            const ref = `C${++n}`;
            claimRefs.set(ref, id);
            return `   [${ref}] ${claimText.get(id)}`;
          });
          return `[K${i + 1}] ${c.name}\n${lines.join("\n")}`;
        })
        .join("\n");
      const res = await aiStructured({
        operation: "knowledge.global_relations",
        userId,
        effort: "low",
        system: `${KNOWLEDGE_SYSTEM}\nAhora SOLO debes proponer relaciones entre conceptos (K#) de distintas partes del documento, justificadas por las afirmaciones C#.`,
        content: [{ type: "text", text }],
        schema: globalRelationsSchema,
      });
      await withUser(userId, async (tx) => {
        for (const r of res.data.relations) {
          const a = keyMap.get(r.from);
          const b = keyMap.get(r.to);
          const ids = [...new Set(r.claimRefs.map((x) => claimRefs.get(x)).filter((x): x is string => !!x))];
          if (!a || !b || a.id === b.id || !ids.length) continue;
          await tx.insert(conceptRelations).values({ userId, documentId, fromConceptId: a.id, toConceptId: b.id, type: r.type, description: r.description, claimIds: ids });
        }
      });
    }

    if (!nameToConcept.size) throw new PermanentJobError("La IA no identificó conceptos con respaldo suficiente.");

    await setDocumentStatus(userId, documentId, "BUILDING_KNOWLEDGE", "Generando actividades de recuerdo activo");
    const gen = await generateActivitiesForDocument(userId, documentId);

    await setDocumentStatus(
      userId,
      documentId,
      "READY",
      `Listo: ${nameToConcept.size} conceptos y ${gen.created} actividades.` +
        (droppedTotal || gen.rejected ? ` Se descartaron ${droppedTotal} elementos de conocimiento y ${gen.rejected} actividades sin respaldo válido.` : ""),
      { knowledgeBuiltAt: new Date(), error: null, errorCode: null },
    );
  } catch (e) {
    const isLast = job.attempts >= job.maxAttempts || e instanceof PermanentJobError || (e instanceof AiUnavailableError && !e.retryable);
    await setDocumentStatus(
      userId,
      documentId,
      isLast ? "FAILED" : "BUILDING_KNOWLEDGE",
      isLast ? null : "Error temporal; se reintentará automáticamente.",
      isLast ? { error: `No se pudo construir el conocimiento: ${e instanceof Error ? e.message : String(e)}`, errorCode: "KNOWLEDGE_FAILED" } : {},
    );
    if (isLast) throw new PermanentJobError(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Datos del explorador de conceptos de un documento. */
export async function getDocumentKnowledge(userId: string, documentId: string) {
  return withUser(userId, async (tx) => {
    const cs = await tx.select().from(concepts).where(eq(concepts.documentId, documentId)).orderBy(asc(concepts.createdAt));
    const rels = await tx.select().from(conceptRelations).where(eq(conceptRelations.documentId, documentId));
    return { concepts: cs, relations: rels };
  });
}

export async function getConceptDetail(userId: string, conceptId: string) {
  return withUser(userId, async (tx) => {
    const [c] = await tx.select().from(concepts).where(and(eq(concepts.id, conceptId), eq(concepts.userId, userId)));
    if (!c) return null;
    const [doc] = c.documentId ? await tx.select({ id: documents.id, title: documents.title }).from(documents).where(eq(documents.id, c.documentId)) : [];
    const [page] = c.pageId
      ? await tx.select({ id: notebookPages.id, title: notebookPages.title, notebookId: notebookPages.notebookId }).from(notebookPages).where(eq(notebookPages.id, c.pageId))
      : [];
    const links = await tx.select({ claimId: conceptClaims.claimId }).from(conceptClaims).where(eq(conceptClaims.conceptId, conceptId));
    const ids = links.map((l) => l.claimId);
    const cl = ids.length
      ? await tx
          .select({ id: claims.id, text: claims.finalText, original: claims.originalText, basis: claims.validationBasis, page: chunks.page, chunkId: chunks.id, quote: claims.quote, sourceKind: claims.sourceKind, pageId: claims.pageId })
          .from(claims)
          .leftJoin(chunks, eq(chunks.id, claims.chunkId))
          .where(inArray(claims.id, ids))
      : [];
    const relsOut = await tx
      .select({ id: conceptRelations.id, type: conceptRelations.type, description: conceptRelations.description, otherId: concepts.id, otherName: concepts.name })
      .from(conceptRelations)
      .innerJoin(concepts, eq(concepts.id, conceptRelations.toConceptId))
      .where(eq(conceptRelations.fromConceptId, conceptId));
    const relsIn = await tx
      .select({ id: conceptRelations.id, type: conceptRelations.type, description: conceptRelations.description, otherId: concepts.id, otherName: concepts.name })
      .from(conceptRelations)
      .innerJoin(concepts, eq(concepts.id, conceptRelations.fromConceptId))
      .where(eq(conceptRelations.toConceptId, conceptId));
    return { concept: c, document: doc ?? null, notePage: page ?? null, claims: cl, relationsOut: relsOut, relationsIn: relsIn };
  });
}
