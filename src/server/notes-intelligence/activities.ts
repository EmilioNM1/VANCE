/**
 * De los apuntes al sistema de recuerdo activo.
 * Reutiliza el motor de conocimiento (mismo prompt y validación), el generador de actividades
 * (mismas rúbricas) y, para el libro, los conceptos y actividades ya existentes del documento.
 */
import { and, eq, inArray } from "drizzle-orm";
import { withUser } from "@/db/client";
import { activities, chunks, claims, conceptClaims, conceptRelations, concepts, documents, notebookPages, pageConceptLinks, pageDocumentLinks, type ActivityType } from "@/db/schema";
import { aiStructured } from "../ai";
import { KNOWLEDGE_SYSTEM, knowledgeSchema, normName, validateKnowledge } from "../knowledge/build";
import { generateActivitiesForConcepts } from "../activities/generate";
import { retrievePassages } from "../retrieval";
import { keywords } from "../retrieval/local";

export type NoteActivityMode = "NOTES" | "BOOK" | "COMBINED";

export interface BuildResult {
  noteConcepts: number;
  bookConcepts: number;
  created: number;
  reused: number;
  rejected: number;
  messages: string[];
}

/** Conceptos propios de la página a partir de sus afirmaciones validadas (sin duplicar los existentes). */
export async function buildNoteConcepts(userId: string, pageId: string): Promise<{ conceptIds: string[]; messages: string[] }> {
  const data = await withUser(userId, async (tx) => {
    const [page] = await tx.select().from(notebookPages).where(eq(notebookPages.id, pageId));
    const valid = await tx
      .select({ id: claims.id, text: claims.finalText })
      .from(claims)
      .where(and(eq(claims.pageId, pageId), eq(claims.validated, true)))
      .orderBy(claims.ord);
    const existing = await tx.select().from(concepts).where(eq(concepts.pageId, pageId));
    const linkedClaims = existing.length
      ? await tx.select({ conceptId: conceptClaims.conceptId, claimId: conceptClaims.claimId }).from(conceptClaims).where(inArray(conceptClaims.conceptId, existing.map((e) => e.id)))
      : [];
    return { page: page!, valid: valid.filter((v) => v.text) as { id: string; text: string }[], existing, linkedClaims };
  });
  if (!data.valid.length) return { conceptIds: data.existing.map((e) => e.id), messages: ["Ninguna afirmación de esta página está validada todavía: revisa el análisis de tus apuntes."] };
  const covered = new Set(data.linkedClaims.map((l) => l.claimId));
  const pending = data.valid.filter((v) => !covered.has(v.id));
  if (!pending.length) return { conceptIds: data.existing.map((e) => e.id), messages: [] };

  const refMap = new Map(data.valid.map((c, i) => [`C${i + 1}`, c.id]));
  const res = await aiStructured({
    operation: "notes.build_knowledge",
    userId,
    effort: "medium",
    cache: true,
    system: `${KNOWLEDGE_SYSTEM}\nEstas afirmaciones proceden de los APUNTES del estudiante (ya validadas). Agrupa en pocos conceptos educativos relevantes; no crees un concepto por frase.`,
    content: [{ type: "text", text: `Página de apuntes: «${data.page.title}»\n\nAFIRMACIONES VALIDADAS:\n${data.valid.map((c, i) => `[C${i + 1}] ${c.text}`).join("\n")}` }],
    schema: knowledgeSchema,
  });
  const clean = validateKnowledge(res.data, refMap);
  const ids = await withUser(userId, async (tx) => {
    const byName = new Map(data.existing.map((e) => [normName(e.name), e.id]));
    const keyToId = new Map<string, string>();
    for (const c of clean.concepts) {
      let id = byName.get(normName(c.name));
      if (!id) {
        const [row] = await tx
          .insert(concepts)
          .values({ userId, pageId, name: c.name, kind: c.kind, summary: c.summary, details: c.details, importance: c.importance })
          .returning({ id: concepts.id });
        id = row!.id;
        byName.set(normName(c.name), id);
      }
      keyToId.set(c.key, id);
      await tx.insert(conceptClaims).values(c.claimIds.map((claimId) => ({ userId, conceptId: id!, claimId }))).onConflictDoNothing();
      await tx.insert(pageConceptLinks).values({ userId, pageId, conceptId: id, origin: "NOTE" }).onConflictDoNothing();
    }
    for (const r of clean.relations)
      await tx.insert(conceptRelations).values({ userId, pageId, fromConceptId: keyToId.get(r.fromKey)!, toConceptId: keyToId.get(r.toKey)!, type: r.type, description: r.description, claimIds: r.claimIds });
    return [...byName.values()];
  });
  return { conceptIds: ids, messages: clean.dropped.length ? [`Se descartaron ${clean.dropped.length} elementos sin respaldo en tus afirmaciones validadas.`] : [] };
}

/**
 * Conceptos del libro relacionados con la página: se recuperan los fragmentos pertinentes y se
 * toman los conceptos YA construidos (y validados) de esos fragmentos. No se gasta IA.
 */
export async function linkBookConcepts(userId: string, pageId: string, max = 10): Promise<{ conceptIds: string[]; messages: string[] }> {
  const ctx = await withUser(userId, async (tx) => {
    const [page] = await tx.select().from(notebookPages).where(eq(notebookPages.id, pageId));
    const links = await tx
      .select({ id: documents.id, status: documents.status, title: documents.title })
      .from(pageDocumentLinks)
      .innerJoin(documents, eq(documents.id, pageDocumentLinks.documentId))
      .where(eq(pageDocumentLinks.pageId, pageId));
    return { page: page!, links };
  });
  const messages: string[] = [];
  if (!ctx.links.length) messages.push("La página no tiene libros vinculados; se buscó en toda tu biblioteca.");
  const notReady = ctx.links.filter((l) => l.status !== "READY");
  if (notReady.length) messages.push(`Aún no tienen conocimiento validado: ${notReady.map((l) => `«${l.title}»`).join(", ")}. Revisa su informe de verificación para poder usarlos.`);
  const query = `${ctx.page.title} ${keywords(ctx.page.contentText, 25).join(" ")}`;
  const { passages } = await retrievePassages(userId, query, { documentIds: ctx.links.length ? ctx.links.map((l) => l.id) : undefined, limit: 12 });
  const chunkIds = [...new Set(passages.map((p) => p.chunkId).filter((x): x is string => !!x))];
  if (!chunkIds.length) return { conceptIds: [], messages: [...messages, "No se encontraron fragmentos del libro relacionados con esta página."] };
  const ids = await withUser(userId, async (tx) => {
    const rows = await tx
      .selectDistinct({ conceptId: conceptClaims.conceptId, importance: concepts.importance })
      .from(conceptClaims)
      .innerJoin(claims, eq(claims.id, conceptClaims.claimId))
      .innerJoin(concepts, eq(concepts.id, conceptClaims.conceptId))
      .innerJoin(chunks, eq(chunks.id, claims.chunkId))
      .innerJoin(documents, eq(documents.id, concepts.documentId))
      .where(and(inArray(claims.chunkId, chunkIds), eq(claims.validated, true), eq(documents.status, "READY")));
    const chosen = rows.sort((a, b) => b.importance - a.importance).slice(0, max).map((r) => r.conceptId);
    if (chosen.length) await tx.insert(pageConceptLinks).values(chosen.map((conceptId) => ({ userId, pageId, conceptId, origin: "BOOK" as const }))).onConflictDoNothing();
    return chosen;
  });
  if (!ids.length) messages.push("Los fragmentos encontrados todavía no tienen conceptos validados en el libro.");
  return { conceptIds: ids, messages };
}

export async function buildPageActivities(userId: string, pageId: string, mode: NoteActivityMode, onlyTypes?: ActivityType[]): Promise<BuildResult> {
  const result: BuildResult = { noteConcepts: 0, bookConcepts: 0, created: 0, reused: 0, rejected: 0, messages: [] };
  let noteIds: string[] = [];
  let bookIds: string[] = [];
  if (mode !== "BOOK") {
    const n = await buildNoteConcepts(userId, pageId);
    noteIds = n.conceptIds;
    result.messages.push(...n.messages);
  }
  if (mode !== "NOTES") {
    const b = await linkBookConcepts(userId, pageId);
    bookIds = b.conceptIds;
    result.messages.push(...b.messages);
  }
  result.noteConcepts = noteIds.length;
  result.bookConcepts = bookIds.length;
  if (noteIds.length) {
    const g = await generateActivitiesForConcepts(userId, noteIds, { pageId, origin: mode === "COMBINED" ? "COMBINED" : "NOTES" }, { extraRelatedConceptIds: mode === "COMBINED" ? bookIds : [], onlyTypes });
    result.created += g.created;
    result.reused += g.reused;
    result.rejected += g.rejected;
  }
  if (bookIds.length) {
    // Las actividades del libro se reutilizan; solo se generan si algún concepto aún no tenía
    const have = await withUser(userId, (tx) => tx.selectDistinct({ id: activities.conceptId }).from(activities).where(inArray(activities.conceptId, bookIds)));
    const missing = bookIds.filter((id) => !have.some((h) => h.id === id));
    result.reused += bookIds.length - missing.length;
    if (missing.length) {
      const docOf = await withUser(userId, (tx) => tx.select({ id: concepts.id, documentId: concepts.documentId }).from(concepts).where(inArray(concepts.id, missing)));
      for (const d of new Set(docOf.map((x) => x.documentId!))) {
        const g = await generateActivitiesForConcepts(userId, docOf.filter((x) => x.documentId === d).map((x) => x.id), { documentId: d, origin: "BOOK" });
        result.created += g.created;
      }
    }
  }
  return result;
}
