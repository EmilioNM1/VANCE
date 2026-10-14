import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, withUser } from "@/db/client";
import { activities, claims, conceptErrors, concepts, jobs, pageConceptLinks, pageVersions, sessionItems } from "@/db/schema";
import { setAiProviderForTests } from "@/server/ai";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { createDocumentFromUpload, createLibrary } from "@/server/documents/service";
import { approveReportAndBuild, decideClaim } from "@/server/verification/review";
import { listClaimsForReport } from "@/server/verification/audit";
import { createNotebook, linkDocument, savePage } from "@/server/notebooks/service";
import { decideNoteClaim, getJobForUser, requestActivities, requestAnalysis } from "@/server/notes-intelligence/jobs";
import { getLatestReview } from "@/server/notes-intelligence/analyze";
import { searchLocal } from "@/server/retrieval/local";
import { getSessionView, startSession, submitAttempt } from "@/server/study/session";
import { getDashboardStats } from "@/server/analytics/stats";
import { makeUser } from "../helpers/db";
import { MUSCLE_DOC, muscleAi } from "../helpers/muscle-ai";

registerAllHandlers();
const ai = muscleAi();

// Respuestas simuladas para las operaciones de apuntes (SOLO PRUEBAS)
ai.handlers["notes.extract_claims"] = (req) => {
  const text = (req.content[0] as { text: string }).text.split("[F1]\n")[1] ?? "";
  const sentences = text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length > 15);
  return { data: { claims: sentences.map((s) => ({ chunkRef: "F1", kind: "MECHANISM", text: s, quote: s, biomedical: true, searchQuery: "muscle", extractionIssue: null })) } };
};
ai.handlers["notes.compare"] = (req) => {
  const text = (req.content[0] as { text: string }).text;
  const claimsIn = [...text.matchAll(/\[(A\d+)\] (.+)/g)].map((m) => ({ ref: m[1]!, t: m[2]! }));
  const passages = [...text.matchAll(/\[(P\d+)\] ([^\n]+)\n([^\n]+)/g)].map((m) => ({ ref: m[1]!, text: m[3]! }));
  const find = (w: string) => passages.find((p) => p.text.includes(w))?.ref ?? passages[0]!.ref;
  return {
    data: {
      results: claimsIn.map((c) =>
        c.t.includes("tropomiosina")
          ? {
              claimRef: c.ref,
              verdict: "CONTRADICTED_BY_BOOK",
              observation: "El libro indica que el calcio se une a la troponina C, no a la tropomiosina.",
              proposedText: "El calcio se une a la troponina C, que desplaza la tropomiosina.",
              passages: [{ ref: find("troponina"), stance: "CONTRADICTS", excerpt: "El calcio se une a la troponina C" }],
            }
          : c.t.includes("mitocondria")
            ? { claimRef: c.ref, verdict: "NOT_IN_BOOK", observation: "El libro no lo trata.", proposedText: null, passages: [] }
            : {
                claimRef: c.ref,
                verdict: "SUPPORTED_BY_BOOK",
                observation: "Coincide con el libro.",
                proposedText: null,
                // P99 no existe: debe descartarse
                passages: [{ ref: find("acetilcolina"), stance: "SUPPORTS", excerpt: "La neurona motora libera acetilcolina" }, { ref: "P99", stance: "SUPPORTS", excerpt: "inventado" }],
              },
      ),
      omissions: [{ description: "Papel de los túbulos T y del receptor RyR1", passageRef: find("túbulos") }, { description: "inventada", passageRef: "P77" }],
    },
  };
};
ai.handlers["notes.build_knowledge"] = (req) => {
  const text = (req.content[0] as { text: string }).text;
  const refs = [...text.matchAll(/\[(C\d+)\] (.+)/g)].map((m) => m[1]!);
  return {
    data: {
      concepts: [
        {
          key: "K1",
          name: "Transmisión neuromuscular (apuntes)",
          kind: "PROCESS",
          summary: "Resumen de los apuntes.",
          importance: 3,
          claimRefs: refs,
          keyTerms: ["acetilcolina", "calcio"],
          steps: [0, 1, 2, 3].map((i) => ({ text: `Paso ${i + 1} de la transmisión`, claimRefs: [refs[i % refs.length]!] })),
          formula: null,
          components: [],
          examples: [],
          exceptions: [],
          misconceptions: [],
          applications: [],
        },
      ],
      relations: [],
    },
  };
};

let userId: string;
let pageId: string;
let documentId: string;

const NOTE = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Contracción muscular (clase)" }] },
    { type: "paragraph", content: [{ type: "text", text: "La neurona motora libera acetilcolina en la unión neuromuscular." }] },
    { type: "paragraph", content: [{ type: "text", text: "Después el calcio se une a la tropomiosina y deja libre la actina." }] },
    { type: "paragraph", content: [{ type: "text", text: "La energía la aporta la mitocondria de la fibra muscular siempre." }] },
    { type: "paragraph", content: [{ type: "text", text: "La miosina se une a la actina y genera fuerza." }] },
  ],
};

beforeAll(async () => {
  setAiProviderForTests(ai);
  userId = (await makeUser("Estudiante de medicina")).id;
  const lib = await createLibrary(userId, { name: "Fisiología médica" });
  const doc = await createDocumentFromUpload(userId, { libraryId: lib.id, rightsConfirmed: true }, { name: "guyton.md", data: Buffer.from(MUSCLE_DOC) });
  documentId = doc.id;
  await drainJobs();
  const corr = (await listClaimsForReport(userId, documentId)).find((c) => c.category === "CORRECTION")!;
  await decideClaim(userId, corr.id, { decision: "ACCEPTED_CORRECTION" });
  await approveReportAndBuild(userId, documentId);
  await drainJobs();
  const nb = await createNotebook(userId, { title: "Fisiología" });
  pageId = nb.pageId;
  await savePage(userId, pageId, { baseVersion: 1, title: "Contracción muscular", content: NOTE });
  await linkDocument(userId, pageId, documentId);
});
afterAll(() => setAiProviderForTests(undefined));

describe("apuntes conectados con libros y memoria", () => {
  it("la búsqueda local en el libro devuelve fragmentos con su página (sin IA)", async () => {
    const r = await searchLocal(userId, "calcio troponina tropomiosina", [documentId]);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.text).toMatch(/troponina/);
    expect(r[0]!.provider).toBe("LOCAL");
  });

  it("contrasta los apuntes con el libro: respaldo, contradicción con corrección, no cubierto y omisiones", async () => {
    const { reviewId } = await requestAnalysis(userId, pageId, { scope: "PAGE" });
    await drainJobs();
    const { review, claims: cl } = await getLatestReview(userId, pageId);
    expect(review!.id).toBe(reviewId);
    expect(review!.status).toBe("DONE");
    expect(review!.retrievalProvider).toBe("local");
    const wrong = cl.find((c) => c.originalText.includes("tropomiosina"))!;
    expect(wrong.category).toBe("CORRECTION");
    expect(wrong.proposedText).toMatch(/troponina C/);
    expect(wrong.sources[0]).toMatchObject({ retrievedVia: "BOOK", documentId, stance: "CONTRADICTS" });
    expect(wrong.validated).toBe(false);
    const ok = cl.find((c) => c.originalText.includes("acetilcolina"))!;
    expect(ok.category).toBe("VERIFIED");
    expect(ok.validationBasis).toBe("BOOK_SOURCE");
    expect(ok.sources).toHaveLength(1); // P99 descartado
    expect(ok.sources[0]!.chunkId).toBeTruthy();
    const notInBook = cl.find((c) => c.originalText.includes("mitocondria"))!;
    expect(notInBook.category).toBe("NEEDS_REVIEW");
    expect(notInBook.validated).toBe(false);
    expect(review!.omissions).toHaveLength(1);
    expect(review!.omissions[0]!.description).toMatch(/túbulos/);
  });

  it("repetir el análisis sin cambios no vuelve a gastar IA", async () => {
    const before = ai.calls.length;
    const r = await requestAnalysis(userId, pageId, { scope: "PAGE" });
    expect(r.cached).toBe(true);
    await drainJobs();
    expect(ai.calls.length).toBe(before);
  });

  it("aceptar una corrección guarda antes una versión y devuelve el reemplazo exacto", async () => {
    const { claims: cl } = await getLatestReview(userId, pageId);
    const wrong = cl.find((c) => c.originalText.includes("tropomiosina"))!;
    const r = await decideNoteClaim(userId, wrong.id, { decision: "ACCEPTED_CORRECTION" });
    expect(r.replace).toEqual({ from: "Después el calcio se une a la tropomiosina y deja libre la actina.", to: "El calcio se une a la troponina C, que desplaza la tropomiosina." });
    expect(r.claim.originalText).toContain("tropomiosina y deja libre"); // el original se conserva
    const v = await withUser(userId, (tx) => tx.select().from(pageVersions).where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.reason, "BEFORE_CORRECTION"))));
    expect(v).toHaveLength(1);
  });

  it("crea preguntas combinando apuntes y libro, conectadas a la página y al sistema de repasos", async () => {
    const { jobId } = await requestActivities(userId, pageId, { mode: "COMBINED" });
    await drainJobs();
    const job = await getJobForUser(userId, jobId);
    expect(job.status).toBe("DONE");
    const result = job.result as { noteConcepts: number; bookConcepts: number; created: number };
    expect(result.noteConcepts).toBe(1);
    expect(result.bookConcepts).toBeGreaterThan(0);
    expect(result.created).toBeGreaterThan(0);
    const links = await withUser(userId, (tx) => tx.select().from(pageConceptLinks).where(eq(pageConceptLinks.pageId, pageId)));
    expect(links.some((l) => l.origin === "NOTE")).toBe(true);
    expect(links.some((l) => l.origin === "BOOK")).toBe(true);
    const noteActs = await withUser(userId, (tx) => tx.select().from(activities).where(eq(activities.pageId, pageId)));
    expect(noteActs.length).toBeGreaterThan(0);
    expect(noteActs.some((a) => a.origin === "COMBINED")).toBe(true);
    expect(noteActs.some((a) => a.type === "DIAGRAM")).toBe(true);
    // Solo se usaron afirmaciones validadas: nunca la de la mitocondria (no verificada)
    const mito = await withUser(userId, (tx) => tx.select().from(claims).where(eq(claims.pageId, pageId)));
    const mitoId = mito.find((c) => c.originalText.includes("mitocondria"))!.id;
    expect(noteActs.every((a) => !a.claimIds.includes(mitoId))).toBe(true);
    // Reutilización: pedirlo otra vez no duplica actividades
    const again = await requestActivities(userId, pageId, { mode: "COMBINED" });
    await drainJobs();
    const r2 = (await getJobForUser(userId, again.jobId)).result as { created: number; reused: number };
    expect(r2.created).toBe(0);
    expect(r2.reused).toBeGreaterThan(0);
  });

  it("sesión desde la página: mezcla preguntas de apuntes y del libro, con referencias a su origen", async () => {
    const { sessionId } = await startSession(userId, { mode: "PAGE", pageId, size: 12 });
    const items = await withUser(userId, (tx) => tx.select({ activityId: sessionItems.activityId }).from(sessionItems).where(eq(sessionItems.sessionId, sessionId)));
    const acts = await withUser(userId, (tx) => tx.select().from(activities));
    const chosen = acts.filter((a) => items.some((i) => i.activityId === a.id));
    expect(chosen.some((a) => a.pageId === pageId)).toBe(true);
    expect(chosen.some((a) => a.documentId === documentId)).toBe(true);
    // Responde una actividad de los apuntes y comprueba que la referencia lleva a la página
    const noteItem = (await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.sessionId, sessionId)))).find(
      (i) => chosen.find((a) => a.id === i.activityId)?.pageId === pageId && chosen.find((a) => a.id === i.activityId)?.type === "DIAGRAM",
    );
    if (noteItem) {
      const act = chosen.find((a) => a.id === noteItem.activityId)!;
      await withUser(userId, (tx) => tx.update(sessionItems).set({ state: "AWAITING_ANSWER", presentedAt: new Date() }).where(eq(sessionItems.id, noteItem.id)));
      const r = await submitAttempt(userId, noteItem.id, { response: { slots: act.answerKey.slots } });
      expect(r.evaluation.score).toBe(1);
      expect(r.evaluation.references[0]!.source).toMatchObject({ kind: "NOTE", pageId });
    }
    const view = await getSessionView(userId, sessionId);
    expect(view.total).toBe(items.length);
    const stats = await getDashboardStats(userId);
    expect(stats.documents.some((d) => d.kind === "NOTE")).toBe(true);
  });

  it("repasar errores anteriores del tema", async () => {
    const [noteConcept] = await withUser(userId, (tx) => tx.select().from(concepts).where(eq(concepts.pageId, pageId)));
    await expect(startSession(userId, { mode: "PAGE", pageId, focus: "ERRORS" })).rejects.toThrow(/No hay errores pendientes/);
    await withUser(userId, (tx) => tx.insert(conceptErrors).values({ userId, conceptId: noteConcept!.id, tag: "orden-pasos", description: "Desordena los pasos", count: 2 }));
    const s = await startSession(userId, { mode: "PAGE", pageId, focus: "ERRORS" });
    const v = await getSessionView(userId, s.sessionId);
    expect(v.current!.reason).toBe("Repasar un error anterior");
  });

  it("sin IA no se lanza el análisis (no se simula)", async () => {
    setAiProviderForTests(null);
    await expect(requestAnalysis(userId, pageId, { scope: "SELECTION", selectionText: "texto suficientemente largo para analizar" })).rejects.toThrow(/requiere IA/);
    setAiProviderForTests(ai);
    void getDb;
    void jobs;
  });
});
