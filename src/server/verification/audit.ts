import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/db/client";
import { chunks, claimRevisions, claimSources, claims, documents, sections, type ClaimVerdict } from "@/db/schema";
import { aiStructured } from "../ai";
import { AiUnavailableError } from "../ai/errors";
import type { WebResult } from "../ai/provider";
import { PermanentJobError, type JobRow } from "../jobs/queue";
import { setDocumentStatus } from "../documents/service";
import { categorizeClaim, normalizeUrl, quoteInText } from "./categorize";
import { searchPubmed, type PubmedArticle } from "./pubmed";

const BATCH_CHARS = 9000;
const VERIFY_BATCH = 10;

const KINDS = ["DEFINITION", "FACT", "NUMBER", "FORMULA", "MECHANISM", "PROCESS_STEP", "CLASSIFICATION", "CONCLUSION", "EXAMPLE"] as const;

export const claimExtractionSchema = z.object({
  claims: z.array(
    z.object({
      chunkRef: z.string(),
      kind: z.enum(KINDS),
      text: z.string(),
      quote: z.string(),
      biomedical: z.boolean(),
      searchQuery: z.string(),
      extractionIssue: z.string().nullable(),
    }),
  ),
});

const VERDICTS = ["SUPPORTED", "CONFIRMED_ERROR", "POSSIBLE_ERROR", "OUTDATED", "SOURCE_DISAGREEMENT", "UNVERIFIABLE", "EXTRACTION_ERROR"] as const;

export const verificationSchema = z.object({
  results: z.array(
    z.object({
      claimRef: z.string(),
      verdict: z.enum(VERDICTS),
      rationale: z.string(),
      proposedText: z.string().nullable(),
      sources: z.array(
        z.object({
          evidenceId: z.string().nullable(),
          url: z.string().nullable(),
          stance: z.enum(["SUPPORTS", "CONTRADICTS", "MIXED"]),
          excerpt: z.string(),
        }),
      ),
    }),
  ),
});

export const contradictionSchema = z.object({
  pairs: z.array(z.object({ a: z.string(), b: z.string(), explanation: z.string() })),
});

const EXTRACT_SYSTEM = `Eres un auditor académico. Recibes fragmentos (F1, F2…) de un material de estudio.
Extrae las afirmaciones atómicas que un estudiante debería aprender: definiciones, hechos, cifras, fórmulas, mecanismos, pasos de procesos, clasificaciones y conclusiones.
Reglas:
- Una afirmación por idea, autocontenida (sustituye pronombres por su referente), en el MISMO idioma que el fragmento.
- Reproduce lo que DICE el documento, aunque creas que es incorrecto (la verificación es un paso posterior). No añadas información externa.
- "quote" debe ser una cita LITERAL y exacta del fragmento (máx. 300 caracteres) que respalde la afirmación.
- "extractionIssue": describe si el texto parece mal extraído (palabras cortadas, OCR defectuoso, fórmula ilegible); si no, null.
- "biomedical": true si es contenido de ciencias de la salud/biología verificable en literatura biomédica.
- "searchQuery": 3-8 palabras clave en inglés para buscar literatura científica sobre la afirmación.
- Omite índices, agradecimientos, ejercicios sin contenido y frases puramente retóricas.`;

const VERIFY_SYSTEM = `Eres un verificador científico riguroso. Evalúas la VALIDEZ CIENTÍFICA de afirmaciones extraídas de un material de estudio (la fidelidad al documento ya se comprobó aparte).
Dispones de: (a) evidencias de PubMed numeradas (E1, E2…), si las hay; (b) la herramienta de búsqueda web, si está disponible.
Prioriza libros de referencia reconocidos, publicaciones revisadas por pares, revisiones sistemáticas, guías clínicas oficiales y fuentes institucionales.
Veredictos:
- SUPPORTED: fuentes fiables respaldan la afirmación.
- CONFIRMED_ERROR: fuentes fiables la contradicen claramente. Propón la corrección (proposedText) en el idioma original.
- POSSIBLE_ERROR: sospechas un error pero la evidencia no es concluyente. Puedes proponer corrección.
- OUTDATED: era aceptada pero el conocimiento actual la ha modificado. Propón la versión actual.
- SOURCE_DISAGREEMENT: fuentes fiables discrepan legítimamente.
- UNVERIFIABLE: no encontraste evidencia suficiente para confirmar ni refutar.
- EXTRACTION_ERROR: el texto parece un error de transcripción/OCR; propón la versión probablemente correcta.
Reglas estrictas sobre fuentes:
- En "sources" cita SOLO evidencias E# proporcionadas (evidenceId) o URLs que hayas obtenido realmente con la búsqueda web en esta conversación (url). Nunca inventes títulos, autores, DOI, PMID ni enlaces.
- Si no tienes fuente, deja "sources" vacío y usa UNVERIFIABLE (o POSSIBLE_ERROR si sospechas error por conocimiento general).
- "excerpt": frase breve (≤ 250 caracteres) de la fuente que justifica tu postura.
- "rationale": explicación breve en español del motivo del veredicto y, si hay corrección, del cambio.
- Tolera simplificaciones didácticas correctas; no marques como error una simplificación razonable para el nivel del texto.`;

const CONTRADICTION_SYSTEM = `Detecta contradicciones INTERNAS entre afirmaciones de un mismo documento (A1, A2…): pares que no pueden ser ciertos a la vez (cifras incompatibles, definiciones opuestas, órdenes de pasos distintos). No incluyas pares que solo son diferentes o complementarios. Explica cada contradicción en español.`;

function chunkText(c: { text: string; editedText: string | null }) {
  return c.editedText ?? c.text;
}

export async function handleAudit(job: JobRow) {
  const { documentId } = job.payload as { documentId: string };
  const userId = job.userId!;
  const loaded = await withUser(userId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return null;
    const chs = await tx.select().from(chunks).where(eq(chunks.documentId, documentId)).orderBy(asc(chunks.ord));
    const secs = await tx.select().from(sections).where(eq(sections.documentId, documentId));
    const existing = await tx.select({ chunkId: claims.chunkId }).from(claims).where(eq(claims.documentId, documentId));
    return { doc, chs, secs, doneChunks: new Set(existing.map((e) => e.chunkId)) };
  });
  if (!loaded) return;
  const { doc, chs, secs, doneChunks } = loaded;
  const secTitle = new Map(secs.map((s) => [s.id, s.title]));

  try {
    // 1) Extracción de afirmaciones por lotes (reanudable: se saltan fragmentos ya procesados)
    const pending = chs.filter((c) => !doneChunks.has(c.id));
    const batches: (typeof chs)[] = [];
    let cur: typeof chs = [];
    let size = 0;
    for (const c of pending) {
      const len = chunkText(c).length;
      if (cur.length && size + len > BATCH_CHARS) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(c);
      size += len;
    }
    if (cur.length) batches.push(cur);

    let ordBase = (await withUser(userId, (tx) => tx.select({ id: claims.id }).from(claims).where(eq(claims.documentId, documentId)))).length;
    for (let b = 0; b < batches.length; b++) {
      await setDocumentStatus(userId, documentId, "AUDITING", `Identificando afirmaciones: lote ${b + 1} de ${batches.length}`);
      const batch = batches[b]!;
      const refs = new Map(batch.map((c, i) => [`F${i + 1}`, c]));
      const res = await aiStructured({
        operation: "audit.extract_claims",
        cache: true,
        userId,
        effort: "low",
        system: EXTRACT_SYSTEM,
        content: [
          {
            type: "text",
            text:
              `Documento: «${doc.title}»\n\n` +
              batch
                .map((c, i) => `[F${i + 1}] (sección: ${secTitle.get(c.sectionId ?? "") ?? "—"}; página: ${c.page ?? "—"})\n${chunkText(c)}`)
                .join("\n\n"),
          },
        ],
        schema: claimExtractionSchema,
      });
      const rows = res.data.claims
        .filter((c) => refs.has(c.chunkRef) && c.text.trim().length > 3)
        .map((c) => {
          const chunk = refs.get(c.chunkRef)!;
          return {
            userId,
            documentId,
            chunkId: chunk.id,
            ord: ordBase++,
            kind: c.kind,
            originalText: c.text.trim(),
            quote: c.quote.trim() || null,
            quoteVerified: quoteInText(c.quote, chunkText(chunk)),
            meta: { searchQuery: c.searchQuery, biomedical: c.biomedical, extractionIssue: c.extractionIssue },
          };
        });
      await withUser(userId, async (tx) => {
        if (rows.length) await tx.insert(claims).values(rows);
      });
    }

    // 2) Verificación por lotes de afirmaciones aún pendientes
    const toVerify = await withUser(userId, (tx) =>
      tx.select().from(claims).where(and(eq(claims.documentId, documentId), eq(claims.verdict, "PENDING"))).orderBy(asc(claims.ord)),
    );
    const total = Math.ceil(toVerify.length / VERIFY_BATCH);
    for (let i = 0; i < toVerify.length; i += VERIFY_BATCH) {
      await setDocumentStatus(userId, documentId, "AUDITING", `Verificando afirmaciones: lote ${i / VERIFY_BATCH + 1} de ${total}`);
      await verifyBatch(userId, toVerify.slice(i, i + VERIFY_BATCH));
    }

    // 3) Contradicciones internas
    await setDocumentStatus(userId, documentId, "AUDITING", "Buscando contradicciones internas");
    await detectContradictions(userId, documentId);

    await setDocumentStatus(userId, documentId, "REVIEW", "Auditoría completada. Revisa el informe antes de generar el conocimiento.", {
      auditCompletedAt: new Date(),
      error: null,
      errorCode: null,
    });
  } catch (e) {
    const isLast = job.attempts >= job.maxAttempts || (e instanceof AiUnavailableError && !e.retryable);
    await setDocumentStatus(
      userId,
      documentId,
      isLast ? "FAILED" : "AUDITING",
      isLast ? null : "La IA no está disponible temporalmente; la auditoría se reanudará automáticamente.",
      isLast
        ? { error: `La auditoría no pudo completarse: ${e instanceof Error ? e.message : String(e)}. Puedes reintentarla; se conservará lo ya procesado.`, errorCode: "AUDIT_FAILED" }
        : {},
    );
    if (isLast) throw new PermanentJobError(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

type ClaimRow = typeof claims.$inferSelect;

async function gatherPubmedEvidence(batch: ClaimRow[]): Promise<{ id: string; article: PubmedArticle }[]> {
  if (process.env.VERIFY_WITH_PUBMED === "false") return [];
  const seen = new Map<string, PubmedArticle>();
  for (const c of batch) {
    if (!c.meta.biomedical || !c.meta.searchQuery) continue;
    try {
      for (const a of await searchPubmed(c.meta.searchQuery, 2)) seen.set(a.pmid, a);
    } catch (e) {
      console.warn("[audit] PubMed no disponible:", e instanceof Error ? e.message : e);
      break;
    }
    if (seen.size >= 12) break;
  }
  return [...seen.values()].map((article, i) => ({ id: `E${i + 1}`, article }));
}

export async function verifyBatch(userId: string, batch: ClaimRow[]) {
  const evidence = await gatherPubmedEvidence(batch);
  const useWeb = process.env.VERIFY_WITH_WEB_SEARCH !== "false";
  const refs = new Map(batch.map((c, i) => [`A${i + 1}`, c]));
  const evidenceText = evidence.length
    ? evidence
        .map((e) => `[${e.id}] PMID ${e.article.pmid} — ${e.article.title} (${e.article.journal ?? "?"}, ${e.article.year ?? "?"})\n${e.article.abstract.slice(0, 1500)}`)
        .join("\n\n")
    : "(No hay evidencias de PubMed para este lote.)";
  const res = await aiStructured({
    operation: "audit.verify_claims",
    userId,
    effort: "medium",
    system: VERIFY_SYSTEM,
    webSearch: useWeb ? { maxUses: 5 } : undefined,
    content: [
      {
        type: "text",
        text:
          `AFIRMACIONES:\n${batch.map((c, i) => `[A${i + 1}] (${c.kind}) ${c.originalText}`).join("\n")}\n\n` +
          `EVIDENCIAS DE PUBMED:\n${evidenceText}\n\n` +
          (useWeb ? "Puedes usar la búsqueda web para contrastar." : "La búsqueda web NO está disponible: usa solo las evidencias E#."),
      },
    ],
    schema: verificationSchema,
  });
  await applyVerification(userId, refs, res.data, evidence, res.webResults);
}

/** Aplica resultados de verificación descartando cualquier fuente no comprobable. Exportada para pruebas. */
export async function applyVerification(
  userId: string,
  refs: Map<string, ClaimRow>,
  data: z.infer<typeof verificationSchema>,
  evidence: { id: string; article: PubmedArticle }[],
  webResults: WebResult[],
) {
  const evidenceById = new Map(evidence.map((e) => [e.id, e.article]));
  const webByUrl = new Map<string, WebResult>();
  for (const w of webResults) {
    const n = normalizeUrl(w.url);
    if (n) webByUrl.set(n, w);
  }
  const handled = new Set<string>();
  await withUser(userId, async (tx) => {
    for (const r of data.results) {
      const claim = refs.get(r.claimRef);
      if (!claim || handled.has(claim.id)) continue;
      handled.add(claim.id);
      const sources: (typeof claimSources.$inferInsert)[] = [];
      let dropped = 0;
      for (const s of r.sources) {
        const art = s.evidenceId ? evidenceById.get(s.evidenceId) : undefined;
        if (art) {
          sources.push({
            userId,
            claimId: claim.id,
            retrievedVia: "PUBMED",
            title: art.title,
            url: art.url,
            pmid: art.pmid,
            doi: art.doi,
            journal: art.journal,
            year: art.year,
            excerpt: s.excerpt.slice(0, 400),
            stance: s.stance,
          });
          continue;
        }
        const n = s.url ? normalizeUrl(s.url) : null;
        const web = n ? webByUrl.get(n) : undefined;
        if (web) {
          sources.push({ userId, claimId: claim.id, retrievedVia: "WEB_SEARCH", title: web.title, url: web.url, excerpt: s.excerpt.slice(0, 400), stance: s.stance });
          continue;
        }
        dropped++;
      }
      const uniq = [...new Map(sources.map((s) => [s.url, s])).values()];
      const extractionIssue = claim.meta.extractionIssue;
      const verdict: ClaimVerdict = r.verdict === "SUPPORTED" && extractionIssue ? "EXTRACTION_ERROR" : r.verdict;
      const cat = categorizeClaim({ verdict, validSources: uniq.length, hasProposal: !!r.proposedText?.trim() });
      const notes = [r.rationale.trim()];
      if (cat.note) notes.push(cat.note);
      if (dropped) notes.push(`Se descartaron ${dropped} referencia(s) que no pudieron comprobarse.`);
      if (!claim.quoteVerified) notes.push("La cita literal no coincide exactamente con el fragmento: revisa la fidelidad de la extracción.");
      if (extractionIssue) notes.push(`Posible error de extracción: ${extractionIssue}`);
      await tx
        .update(claims)
        .set({
          verdict: cat.verdict,
          category: cat.category,
          proposedText: r.proposedText?.trim() || null,
          rationale: notes.join(" "),
          verificationMethod: [evidence.length ? "pubmed" : null, webResults.length ? "web_search" : null, "ia"].filter(Boolean).join("+"),
          validated: cat.autoValidated && claim.decision === "PENDING",
          finalText: cat.autoValidated ? claim.originalText : null,
          validationBasis: cat.autoValidated ? "EXTERNAL_SOURCE" : null,
          updatedAt: new Date(),
        })
        .where(eq(claims.id, claim.id));
      await tx.delete(claimSources).where(eq(claimSources.claimId, claim.id));
      if (uniq.length) await tx.insert(claimSources).values(uniq);
      await tx.insert(claimRevisions).values({
        userId,
        claimId: claim.id,
        actor: "AI",
        action: "VERIFY",
        after: { verdict: cat.verdict, category: cat.category, proposedText: r.proposedText, sources: uniq.length },
        note: notes.join(" "),
      });
    }
    // Afirmaciones que la IA no devolvió: quedan como no verificables (nunca se validan solas)
    for (const claim of refs.values()) {
      if (handled.has(claim.id)) continue;
      await tx
        .update(claims)
        .set({ verdict: "UNVERIFIABLE", category: "NEEDS_REVIEW", rationale: "La verificación no devolvió resultado para esta afirmación.", updatedAt: new Date() })
        .where(eq(claims.id, claim.id));
    }
  });
}

async function detectContradictions(userId: string, documentId: string) {
  const all = await withUser(userId, (tx) =>
    tx.select({ id: claims.id, text: claims.originalText, category: claims.category }).from(claims).where(eq(claims.documentId, documentId)).orderBy(asc(claims.ord)),
  );
  for (let i = 0; i < all.length; i += 200) {
    const slice = all.slice(i, i + 200);
    if (slice.length < 2) continue;
    const refs = new Map(slice.map((c, j) => [`A${j + 1}`, c]));
    const res = await aiStructured({
      operation: "audit.contradictions",
      userId,
      effort: "low",
      system: CONTRADICTION_SYSTEM,
      content: [{ type: "text", text: slice.map((c, j) => `[A${j + 1}] ${c.text}`).join("\n") }],
      schema: contradictionSchema,
    });
    await withUser(userId, async (tx) => {
      for (const p of res.data.pairs) {
        const a = refs.get(p.a);
        const b = refs.get(p.b);
        if (!a || !b || a.id === b.id) continue;
        for (const [x, y] of [
          [a, b],
          [b, a],
        ] as const) {
          const [row] = await tx.select().from(claims).where(eq(claims.id, x.id));
          if (!row) continue;
          await tx
            .update(claims)
            .set({
              verdict: row.category === "CORRECTION" ? row.verdict : "INTERNAL_CONTRADICTION",
              category: row.category === "CORRECTION" ? "CORRECTION" : "NEEDS_REVIEW",
              validated: false,
              validationBasis: null,
              contradictsClaimIds: [...new Set([...row.contradictsClaimIds, y.id])],
              rationale: `${row.rationale ?? ""} Contradicción interna con otra afirmación del documento: ${p.explanation}`.trim(),
              updatedAt: new Date(),
            })
            .where(eq(claims.id, x.id));
        }
      }
    });
  }
}

export async function listClaimsForReport(userId: string, documentId: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ claim: claims, chunkPage: chunks.page, chunkText: chunks.text, chunkEdited: chunks.editedText })
      .from(claims)
      .innerJoin(chunks, eq(chunks.id, claims.chunkId))
      .where(eq(claims.documentId, documentId))
      .orderBy(asc(claims.ord));
    const ids = rows.map((r) => r.claim.id);
    const srcs = ids.length ? await tx.select().from(claimSources).where(inArray(claimSources.claimId, ids)) : [];
    const byClaim = new Map<string, (typeof srcs)[number][]>();
    for (const s of srcs) byClaim.set(s.claimId, [...(byClaim.get(s.claimId) ?? []), s]);
    return rows.map((r) => ({ ...r.claim, page: r.chunkPage, sources: byClaim.get(r.claim.id) ?? [] }));
  });
}
