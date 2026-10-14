/**
 * Contraste de apuntes con los libros del estudiante.
 *
 * Distinción clave (no se confunden):
 *  - Libro: fuente documental recuperada (fragmentos con documento y página).
 *  - Apunte: lo que el estudiante escribió (afirmaciones de origen NOTE, con su cita literal).
 *  - Fuentes externas (PubMed/web): solo si el usuario lo habilita y el libro no basta.
 *
 * Coste: solo se ejecuta bajo demanda; la extracción de afirmaciones se cachea por contenido,
 * y la recuperación usa primero la búsqueda local gratuita o File Search (sin enviar libros completos).
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/db/client";
import { claimRevisions, claimSources, claims, conceptClaims, documents, noteReviews, notebookPages, pageDocumentLinks } from "@/db/schema";
import { aiStructured } from "../ai";
import { claimExtractionSchema, verifyBatch } from "../verification/audit";
import { categorizeClaim, quoteInText } from "../verification/categorize";
import { retrievePassages, type Passage } from "../retrieval";
import { normName } from "../knowledge/build";

const NOTE_EXTRACT_SYSTEM = `Eres un auditor académico. Recibes APUNTES escritos por un estudiante (F1…).
Extrae las afirmaciones atómicas con contenido educativo relevante (definiciones, hechos, cifras, fórmulas, mecanismos, pasos de procesos, clasificaciones, conclusiones).
Reglas:
- Reproduce lo que el estudiante escribió aunque creas que es incorrecto; la comparación con el libro es un paso posterior.
- No crees una afirmación por cada frase: agrupa ideas y omite frases sin contenido (recordatorios, títulos sueltos, opiniones).
- "quote" debe ser una cita LITERAL y exacta del apunte (la frase o fragmento donde aparece), máx. 300 caracteres.
- "extractionIssue": null (los apuntes no tienen problemas de extracción).
- "biomedical" y "searchQuery" (3-8 palabras clave en inglés) como en un artículo científico.
- Escribe en el idioma del apunte.`;

export const compareSchema = z.object({
  results: z.array(
    z.object({
      claimRef: z.string(),
      verdict: z.enum(["SUPPORTED_BY_BOOK", "CONTRADICTED_BY_BOOK", "IMPRECISE", "NOT_IN_BOOK"]),
      observation: z.string(),
      proposedText: z.string().nullable(),
      passages: z.array(z.object({ ref: z.string(), stance: z.enum(["SUPPORTS", "CONTRADICTS", "MIXED"]), excerpt: z.string() })),
    }),
  ),
  omissions: z.array(z.object({ description: z.string(), passageRef: z.string() })),
});

const COMPARE_SYSTEM = `Comparas los APUNTES de un estudiante (A1, A2…) con PASAJES recuperados de sus libros de referencia (P1, P2…).
Para cada afirmación del apunte:
- SUPPORTED_BY_BOOK: algún pasaje la respalda.
- CONTRADICTED_BY_BOOK: algún pasaje la contradice. "proposedText" = versión corregida del fragmento literal del apunte, manteniendo el estilo del estudiante.
- IMPRECISE: es incompleta o imprecisa según los pasajes. Propón la versión corregida.
- NOT_IN_BOOK: los pasajes no tratan esta afirmación (no inventes respaldo).
Reglas estrictas:
- Cita en "passages" SOLO referencias P# que aparecen arriba; "excerpt" = frase literal breve del pasaje (≤ 250 caracteres).
- No uses conocimiento propio para decidir SUPPORTED o CONTRADICTED: solo lo que dicen los pasajes. Si no hay pasajes pertinentes, usa NOT_IN_BOOK.
- "observation": explicación breve en español para el estudiante.
- "omissions": conceptos IMPORTANTES de los pasajes que el apunte no menciona y deberían estar (máx. 5), cada uno con su P#.
- Tolera paráfrasis y simplificaciones correctas.`;

export async function createReview(userId: string, pageId: string, input: { scope: "PAGE" | "SELECTION"; selectionText?: string | null; externalVerification?: boolean }) {
  return withUser(userId, async (tx) => {
    const [p] = await tx.select().from(notebookPages).where(and(eq(notebookPages.id, pageId), eq(notebookPages.userId, userId)));
    if (!p) return null;
    const [r] = await tx
      .insert(noteReviews)
      .values({
        userId,
        pageId,
        scope: input.scope,
        selectionText: input.scope === "SELECTION" ? input.selectionText?.slice(0, 20_000) ?? null : null,
        contentHash: p.contentHash,
        externalVerification: !!input.externalVerification && process.env.VERIFY_WITH_WEB_SEARCH !== "false",
      })
      .returning();
    return r!;
  });
}

async function setReview(userId: string, reviewId: string, patch: Partial<typeof noteReviews.$inferInsert>) {
  await withUser(userId, (tx) => tx.update(noteReviews).set(patch).where(eq(noteReviews.id, reviewId)));
}

/** Divide un texto largo en segmentos por párrafos para la extracción. */
export function segments(text: string, max = 6000): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of text.split(/\n{2,}/)) {
    if (cur && cur.length + p.length > max) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export async function runNoteReview(userId: string, reviewId: string) {
  const ctx = await withUser(userId, async (tx) => {
    const [r] = await tx.select().from(noteReviews).where(eq(noteReviews.id, reviewId));
    if (!r) return null;
    const [p] = await tx.select().from(notebookPages).where(eq(notebookPages.id, r.pageId));
    const links = await tx.select({ documentId: pageDocumentLinks.documentId }).from(pageDocumentLinks).where(eq(pageDocumentLinks.pageId, r.pageId));
    return { review: r, page: p!, linkedDocIds: links.map((l) => l.documentId) };
  });
  if (!ctx) return;
  const { review, page } = ctx;
  const text = (review.scope === "SELECTION" ? review.selectionText : page.contentText)?.trim() ?? "";
  try {
    await setReview(userId, reviewId, { status: "RUNNING", statusDetail: "Identificando los conceptos de tus apuntes" });
    if (text.length < 20) throw new Error("No hay suficiente texto para analizar.");

    // 1) Afirmaciones del apunte (cacheadas por contenido)
    const extracted: z.infer<typeof claimExtractionSchema>["claims"] = [];
    for (const seg of segments(text)) {
      const res = await aiStructured({
        operation: "notes.extract_claims",
        userId,
        effort: "low",
        cache: true,
        system: NOTE_EXTRACT_SYSTEM,
        content: [{ type: "text", text: `Página: «${page.title}»\n\n[F1]\n${seg}` }],
        schema: claimExtractionSchema,
      });
      extracted.push(...res.data.claims);
    }

    // 2) Sustituye afirmaciones pendientes de análisis anteriores (conserva las ya decididas o usadas)
    const created = await withUser(userId, async (tx) => {
      const used = await tx.select({ id: conceptClaims.claimId }).from(conceptClaims).innerJoin(claims, eq(claims.id, conceptClaims.claimId)).where(eq(claims.pageId, page.id));
      if (review.scope === "PAGE")
        await tx
          .delete(claims)
          .where(and(eq(claims.pageId, page.id), eq(claims.decision, "PENDING"), used.length ? notInArray(claims.id, used.map((u) => u.id)) : undefined));
      const kept = await tx.select({ originalText: claims.originalText, ord: claims.ord }).from(claims).where(eq(claims.pageId, page.id));
      const seen = new Set(kept.map((k) => normName(k.originalText)));
      let ord = kept.reduce((m, k) => Math.max(m, k.ord), -1) + 1;
      const rows = extracted
        .filter((c) => c.text.trim().length > 3 && !seen.has(normName(c.text)) && (seen.add(normName(c.text)), true))
        .map((c) => ({
          userId,
          sourceKind: "NOTE" as const,
          pageId: page.id,
          noteReviewId: reviewId,
          ord: ord++,
          kind: c.kind,
          originalText: c.text.trim(),
          quote: c.quote.trim() || null,
          quoteVerified: quoteInText(c.quote, text),
          meta: { searchQuery: c.searchQuery, biomedical: c.biomedical, extractionIssue: null },
        }));
      return rows.length ? tx.insert(claims).values(rows).returning() : ([] as ClaimRow[]);
    });
    if (!created.length) {
      await finish(userId, reviewId, page, [], "Sin afirmaciones nuevas que contrastar.");
      return;
    }

    // 3) Recuperación en los libros (vinculados a la página o, si no hay, todos los del usuario)
    await setReview(userId, reviewId, { statusDetail: "Buscando los fragmentos pertinentes en tus libros" });
    const omissions: (typeof noteReviews.$inferInsert)["omissions"] = [];
    const notInBook: ClaimRow[] = [];
    let provider = "none";
    for (let i = 0; i < created.length; i += 8) {
      const batch = created.slice(i, i + 8);
      const query = `${page.title}. ${batch.map((c) => c.originalText).join(" ")}`;
      const r = await retrievePassages(userId, query, { documentIds: ctx.linkedDocIds.length ? ctx.linkedDocIds : undefined, limit: 8 });
      provider = r.provider;
      if (!r.passages.length) {
        notInBook.push(...batch);
        await markNoBook(userId, batch.map((c) => c.id));
        continue;
      }
      await setReview(userId, reviewId, { statusDetail: `Comparando tus apuntes con el libro (${Math.min(i + 8, created.length)}/${created.length})` });
      const res = await aiStructured({
        operation: "notes.compare",
        userId,
        effort: "medium",
        cache: true,
        system: COMPARE_SYSTEM,
        content: [
          {
            type: "text",
            text:
              `APUNTES:\n${batch.map((c, k) => `[A${k + 1}] ${c.originalText}${c.quote ? `\n   (literal: «${c.quote}»)` : ""}`).join("\n")}\n\n` +
              `PASAJES:\n${r.passages.map((p, k) => `[P${k + 1}] ${p.documentTitle}${p.page ? `, pág. ${p.page}` : ""}\n${p.text.slice(0, 1800)}`).join("\n\n")}`,
          },
        ],
        schema: compareSchema,
      });
      const out = await applyComparison(userId, batch, r.passages, res.data);
      notInBook.push(...out.notInBook);
      omissions.push(...out.omissions);
    }

    // 4) Verificación externa opcional para lo que el libro no cubre (reutiliza la auditoría existente)
    if (review.externalVerification && notInBook.length) {
      await setReview(userId, reviewId, { statusDetail: "Consultando fuentes externas (PubMed y búsqueda web)" });
      const fresh = await withUser(userId, (tx) => tx.select().from(claims).where(inArray(claims.id, notInBook.map((c) => c.id))));
      for (let i = 0; i < fresh.length; i += 10) await verifyBatch(userId, fresh.slice(i, i + 10));
    }
    await finish(userId, reviewId, page, omissions.slice(0, 8), null, provider);
  } catch (e) {
    await setReview(userId, reviewId, { status: "FAILED", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() });
    throw e;
  }
}

async function finish(userId: string, reviewId: string, page: typeof notebookPages.$inferSelect, omissions: (typeof noteReviews.$inferInsert)["omissions"], detail: string | null, provider?: string) {
  await withUser(userId, async (tx) => {
    await tx
      .update(noteReviews)
      .set({ status: "DONE", statusDetail: detail, omissions: omissions ?? [], retrievalProvider: provider ?? null, finishedAt: new Date() })
      .where(eq(noteReviews.id, reviewId));
    await tx.update(notebookPages).set({ lastAnalyzedHash: page.contentHash, lastAnalyzedAt: new Date() }).where(eq(notebookPages.id, page.id));
  });
}

async function markNoBook(userId: string, ids: string[]) {
  await withUser(userId, (tx) =>
    tx
      .update(claims)
      .set({ verdict: "UNVERIFIABLE", category: "NEEDS_REVIEW", rationale: "Tus libros no contienen información sobre esta afirmación.", verificationMethod: "book", updatedAt: new Date() })
      .where(inArray(claims.id, ids)),
  );
}

type ClaimRow = typeof claims.$inferSelect;

/** Aplica la comparación validando que cada referencia corresponda a un pasaje realmente recuperado. Exportada para pruebas. */
export async function applyComparison(userId: string, batch: ClaimRow[], passages: Passage[], data: z.infer<typeof compareSchema>) {
  const byRef = new Map(passages.map((p, k) => [`P${k + 1}`, p]));
  const notInBook: ClaimRow[] = [];
  const handled = new Set<string>();
  const docTitles = new Map(passages.map((p) => [p.documentId, p.documentTitle]));
  await withUser(userId, async (tx) => {
    // Comprueba que los documentos citados son del usuario (defensa adicional)
    const own = new Set(
      (await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.userId, userId), inArray(documents.id, [...docTitles.keys()].length ? [...docTitles.keys()] : ["00000000-0000-0000-0000-000000000000"])))).map((d) => d.id),
    );
    for (const r of data.results) {
      const idx = Number(r.claimRef.replace(/\D/g, "")) - 1;
      const claim = batch[idx];
      if (!claim || handled.has(claim.id)) continue;
      handled.add(claim.id);
      const refs = r.passages.map((p) => ({ ...p, passage: byRef.get(p.ref.trim()) })).filter((p) => p.passage && own.has(p.passage.documentId));
      const supports = refs.filter((p) => p.stance === "SUPPORTS");
      const contradicts = refs.filter((p) => p.stance !== "SUPPORTS");
      let verdict: ClaimRow["verdict"];
      if (r.verdict === "SUPPORTED_BY_BOOK" && supports.length) verdict = "SUPPORTED";
      else if (r.verdict === "CONTRADICTED_BY_BOOK" && contradicts.length) verdict = "CONFIRMED_ERROR";
      else if (r.verdict === "IMPRECISE" && refs.length) verdict = "POSSIBLE_ERROR";
      else verdict = "UNVERIFIABLE";
      const cat = categorizeClaim({ verdict, validSources: refs.length, hasProposal: !!r.proposedText?.trim() });
      if (cat.verdict === "UNVERIFIABLE") notInBook.push(claim);
      const autoBook = cat.autoValidated;
      await tx
        .update(claims)
        .set({
          verdict: cat.verdict,
          category: cat.category,
          proposedText: verdict === "SUPPORTED" ? null : r.proposedText?.trim() || null,
          rationale: [r.observation.trim(), refs.length < r.passages.length ? "Se descartaron referencias que no correspondían a pasajes recuperados." : null].filter(Boolean).join(" "),
          verificationMethod: "book",
          validated: autoBook && claim.decision === "PENDING",
          finalText: autoBook ? claim.originalText : null,
          validationBasis: autoBook ? "BOOK_SOURCE" : null,
          updatedAt: new Date(),
        })
        .where(eq(claims.id, claim.id));
      await tx.delete(claimSources).where(eq(claimSources.claimId, claim.id));
      if (refs.length)
        await tx.insert(claimSources).values(
          refs.map((p) => ({
            userId,
            claimId: claim.id,
            retrievedVia: "BOOK" as const,
            documentId: p.passage!.documentId,
            chunkId: p.passage!.chunkId,
            page: p.passage!.page,
            title: p.passage!.documentTitle,
            url: `/app/documents/${p.passage!.documentId}${p.passage!.chunkId ? `#chunk-${p.passage!.chunkId}` : ""}`,
            excerpt: p.excerpt.slice(0, 400) || p.passage!.text.slice(0, 300),
            stance: p.stance,
          })),
        );
      await tx.insert(claimRevisions).values({ userId, claimId: claim.id, actor: "AI", action: "COMPARE_WITH_BOOK", after: { verdict: cat.verdict, sources: refs.length } });
    }
    const missing = batch.filter((c) => !handled.has(c.id));
    if (missing.length)
      await tx
        .update(claims)
        .set({ verdict: "UNVERIFIABLE", category: "NEEDS_REVIEW", rationale: "La comparación no devolvió resultado para esta afirmación." })
        .where(inArray(claims.id, missing.map((m) => m.id)));
    notInBook.push(...missing);
  });
  const omissions = data.omissions
    .map((o) => ({ o, p: byRef.get(o.passageRef.trim()) }))
    .filter((x) => x.p)
    .map(({ o, p }) => ({ description: o.description, documentId: p!.documentId, documentTitle: p!.documentTitle, page: p!.page, chunkId: p!.chunkId, excerpt: p!.text.slice(0, 280) }));
  return { notInBook, omissions };
}

export async function getLatestReview(userId: string, pageId: string) {
  return withUser(userId, async (tx) => {
    const [r] = await tx.select().from(noteReviews).where(eq(noteReviews.pageId, pageId)).orderBy(sql`${noteReviews.createdAt} desc`).limit(1);
    const cl = await tx.select().from(claims).where(eq(claims.pageId, pageId)).orderBy(claims.ord);
    const srcs = cl.length ? await tx.select().from(claimSources).where(inArray(claimSources.claimId, cl.map((c) => c.id))) : [];
    return {
      review: r ?? null,
      claims: cl.map((c) => ({ ...c, page: null, sources: srcs.filter((s) => s.claimId === c.id) })),
    };
  });
}
