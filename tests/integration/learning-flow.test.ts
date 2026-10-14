import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, withUser } from "@/db/client";
import { activities, claims, conceptErrors, conceptMastery, concepts, documents, evaluations, jobs, reviewLogs, sessionItems } from "@/db/schema";
import { setAiProviderForTests } from "@/server/ai";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { drainJobs } from "@/server/jobs/queue";
import { createDocumentFromUpload, createLibrary, getDocument, getDocumentOverview, NotFoundError } from "@/server/documents/service";
import { approveReportAndBuild, decideClaim } from "@/server/verification/review";
import { listClaimsForReport } from "@/server/verification/audit";
import { getSessionView, requestHint, startSession, submitAttempt } from "@/server/study/session";
import { getDashboardStats } from "@/server/analytics/stats";
import { makeUser } from "../helpers/db";
import { muscleAi } from "../helpers/muscle-ai";
import { makePdf } from "../helpers/pdf";
import { MUSCLE_DOC } from "../helpers/muscle-ai";

registerAllHandlers();
const ai = muscleAi();

let userId: string;
let documentId: string;

beforeAll(async () => {
  setAiProviderForTests(ai);
  userId = (await makeUser("Estudiante")).id;
  const lib = await createLibrary(userId, { name: "Fisiología", subject: "Medicina" });
  const doc = await createDocumentFromUpload(userId, { libraryId: lib.id, rightsConfirmed: true }, { name: "musculo.md", data: Buffer.from(MUSCLE_DOC) });
  documentId = doc.id;
  await drainJobs();
});

afterAll(() => setAiProviderForTests(undefined));

describe("recorrido completo de aprendizaje", () => {
  it("procesa el documento y se detiene en la revisión del informe", async () => {
    const doc = await getDocument(userId, documentId);
    expect(doc.status).toBe("REVIEW");
    const ov = await getDocumentOverview(userId, documentId);
    expect(ov.sections.map((s) => s.title)).toEqual(["Fisiología muscular — Acoplamiento excitación-contracción", "Datos complementarios"]);
  });

  it("el informe distingue verificadas, a revisar y correcciones, y descarta fuentes inventadas", async () => {
    const report = await listClaimsForReport(userId, documentId);
    expect(report.some((c) => c.originalText === "Inventada")).toBe(false);
    const verified = report.filter((c) => c.category === "VERIFIED");
    const review = report.filter((c) => c.category === "NEEDS_REVIEW");
    const corr = report.filter((c) => c.category === "CORRECTION");
    expect(verified.length).toBe(5);
    expect(review.map((c) => c.verdict)).toEqual(["UNVERIFIABLE"]);
    expect(corr).toHaveLength(1);
    expect(corr[0]!.proposedText).toMatch(/filamento grueso/);
    // Solo sobrevive la URL que devolvió de verdad la búsqueda; E7 y el DOI inventado se descartan
    for (const c of verified) {
      expect(c.sources).toHaveLength(1);
      expect(c.sources[0]).toMatchObject({ retrievedVia: "WEB_SEARCH", title: "Excitation-contraction coupling (review)" });
      expect(c.rationale).toMatch(/descartaron 2/);
      expect(c.validated).toBe(true);
      expect(c.quoteVerified).toBe(true);
    }
    // Lo dudoso no se usa como conocimiento validado
    expect(review[0]!.validated).toBe(false);
    expect(corr[0]!.validated).toBe(false);
    expect(corr[0]!.originalText).toMatch(/filamento delgado/); // se conserva el original
  });

  it("el usuario aprueba la corrección; lo no verificable queda fuera", async () => {
    const report = await listClaimsForReport(userId, documentId);
    const corr = report.find((c) => c.category === "CORRECTION")!;
    const updated = await decideClaim(userId, corr.id, { decision: "ACCEPTED_CORRECTION" });
    expect(updated.finalText).toMatch(/filamento grueso/);
    expect(updated.validationBasis).toBe("EXTERNAL_SOURCE");
    await approveReportAndBuild(userId, documentId);
    await drainJobs();
    const doc = await getDocument(userId, documentId);
    expect(doc.status).toBe("READY");
    const cs = await withUser(userId, (tx) => tx.select().from(concepts).where(eq(concepts.documentId, documentId)));
    expect(cs.map((c) => c.name).sort()).toEqual(["Acoplamiento excitación-contracción", "Miosina", "Troponina"]);
    // El dato no verificado (-90 mV) no alimenta ningún concepto
    expect(JSON.stringify(cs)).not.toContain("-90 mV");
  });

  it("cada actividad se rastrea hasta afirmaciones validadas y fragmentos; las sin fuente se rechazan", async () => {
    const acts = await withUser(userId, (tx) => tx.select().from(activities).where(eq(activities.documentId, documentId)));
    expect(acts.length).toBeGreaterThan(5);
    const types = new Set(acts.map((a) => a.type));
    for (const t of ["PROCESS_ORDER", "EXPLAIN", "PREDICTION", "CASE", "FREE_RECALL", "CLOZE", "RECOGNITION"]) expect(types.has(t as never)).toBe(true);
    const validIds = new Set((await withUser(userId, (tx) => tx.select({ id: claims.id }).from(claims).where(eq(claims.validated, true)))).map((c) => c.id));
    for (const a of acts) {
      expect(a.claimIds.length).toBeGreaterThan(0);
      expect(a.chunkIds.length).toBeGreaterThan(0);
      for (const id of a.claimIds) expect(validIds.has(id)).toBe(true);
      // El elemento de rúbrica sin respaldo (C404) fue eliminado
      expect(a.rubric.essentialElements.some((e) => e.description === "Sin respaldo")).toBe(false);
    }
    const doc = await getDocument(userId, documentId);
    expect(doc.statusDetail).toMatch(/actividades sin respaldo válido/);
  });

  it("sesión: reconstrucción de proceso evaluada en servidor sin exponer la clave", async () => {
    const [ecc] = await withUser(userId, (tx) => tx.select().from(concepts).where(eq(concepts.name, "Acoplamiento excitación-contracción")));
    const { sessionId } = await startSession(userId, { mode: "CONCEPT", conceptId: ecc!.id });
    let view = await getSessionView(userId, sessionId);
    expect(view.current).not.toBeNull();
    expect(JSON.stringify(view.current)).not.toContain("answerKey");
    expect(JSON.stringify(view.current)).not.toContain("referenceAnswer");
    // Busca el ítem de orden; si no es el primero, avanza por los demás
    const orderAct = (await withUser(userId, (tx) => tx.select().from(activities).where(and(eq(activities.conceptId, ecc!.id), eq(activities.type, "PROCESS_ORDER")))))[0]!;
    const item = (await withUser(userId, (tx) => tx.select().from(sessionItems).where(and(eq(sessionItems.sessionId, sessionId), eq(sessionItems.activityId, orderAct.id)))))[0];
    expect(item).toBeDefined();
    // Envío manipulado: pasos duplicados → 0 puntos, no se marca correcto
    await withUser(userId, (tx) => tx.update(sessionItems).set({ state: "AWAITING_ANSWER", presentedAt: new Date() }).where(eq(sessionItems.id, item!.id)));
    const bad = await submitAttempt(userId, item!.id, { response: { order: ["s1", "s1", "s1", "s1", "s1"] } });
    expect(bad.evaluation.score).toBe(0);
    expect(bad.state).toBe("AWAITING_RETRY");
    const good = await submitAttempt(userId, item!.id, { response: { order: orderAct.answerKey.order } });
    expect(good.evaluation.score).toBe(1);
    expect(good.state).toBe("DONE");
    view = await getSessionView(userId, sessionId);
    expect(view.summary.find((s) => s.itemId === item!.id)?.firstScore).toBe(0);
  });

  it("respuesta abierta parcialmente correcta: crédito parcial, pista adaptativa, nuevo intento y explicación", async () => {
    const [trop] = await withUser(userId, (tx) => tx.select().from(concepts).where(eq(concepts.name, "Troponina")));
    const act = (await withUser(userId, (tx) => tx.select().from(activities).where(and(eq(activities.conceptId, trop!.id), eq(activities.type, "FREE_RECALL")))))[0]!;
    const { sessionId } = await startSession(userId, { mode: "CONCEPT", conceptId: trop!.id });
    const items = await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.sessionId, sessionId)));
    const item = items.find((i) => i.activityId === act.id)!;
    await withUser(userId, (tx) => tx.update(sessionItems).set({ state: "AWAITING_ANSWER", presentedAt: new Date() }).where(eq(sessionItems.id, item.id)));

    const r1 = await submitAttempt(userId, item.id, { response: { text: "Tiene que ver con el calcio." }, confidence: 2 });
    expect(r1.evaluation.score).toBeGreaterThan(0);
    expect(r1.evaluation.score).toBeLessThan(0.85);
    expect(r1.evaluation.verdict).toBe("PARTIAL");
    expect(r1.evaluation.explanation).toBeUndefined(); // no se revela la solución todavía
    expect(r1.state).toBe("AWAITING_RETRY");
    let view = await getSessionView(userId, sessionId);
    const cur = view.current!.itemId === item.id ? view.current! : null;
    if (cur) {
      expect(cur.hints[0]!.text).toMatch(/Pista adaptada/);
      expect(cur.hintLevel).toBe(1);
    }
    await requestHint(userId, item.id); // nivel 2
    const r2 = await submitAttempt(userId, item.id, { response: { text: "El calcio se une a la tropomiosina" } });
    expect(r2.evaluation.criticalErrors[0]!.tag).toBe("calcio-tropomiosina");
    expect(r2.state).toBe("AWAITING_RETRY");
    // Tercer fallo → explicación completa (nivel 4) y recuperación posterior obligatoria
    const r3 = await submitAttempt(userId, item.id, { response: { text: "No lo sé" } });
    expect(r3.state).toBe("AWAITING_POST_EXPLANATION");
    view = await getSessionView(userId, sessionId);
    const after = await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.id, item.id)));
    expect(after[0]!.explanationShown).toBe(true);
    const r4 = await submitAttempt(userId, item.id, { response: { text: "El calcio se une a la troponina C y la tropomiosina deja libre la actina." } });
    expect(r4.state).toBe("DONE");
    expect(r4.evaluation.explanation).toBeDefined();
    expect(r4.evaluation.references.length).toBeGreaterThan(0);
    // Necesitó la explicación: cuenta como olvido y se programa pronto
    const [log] = await withUser(userId, (tx) => tx.select().from(reviewLogs).where(eq(reviewLogs.conceptId, trop!.id)).orderBy(sql`created_at desc`).limit(1));
    expect(log!.grade).toBe(1);
    expect(log!.scheduledDays).toBeLessThanOrEqual(1);
    // Se añadió una nueva recuperación del mismo concepto al final de la sesión
    const all = await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.sessionId, sessionId)));
    expect(all.some((i) => i.reason === "Nueva recuperación tras la corrección")).toBe(true);
  });

  it("un error conceptual repetido se registra como recurrente y eleva la ayuda", async () => {
    const [trop] = await withUser(userId, (tx) => tx.select().from(concepts).where(eq(concepts.name, "Troponina")));
    const act = (await withUser(userId, (tx) => tx.select().from(activities).where(and(eq(activities.conceptId, trop!.id), eq(activities.type, "FREE_RECALL")))))[0]!;
    const { sessionId } = await startSession(userId, { mode: "CONCEPT", conceptId: trop!.id });
    const item = (await withUser(userId, (tx) => tx.select().from(sessionItems).where(and(eq(sessionItems.sessionId, sessionId), eq(sessionItems.activityId, act.id)))))[0]!;
    await withUser(userId, (tx) => tx.update(sessionItems).set({ state: "AWAITING_ANSWER", presentedAt: new Date() }).where(eq(sessionItems.id, item.id)));
    const r = await submitAttempt(userId, item.id, { response: { text: "El calcio se une a la tropomiosina" } });
    expect(r.state).toBe("AWAITING_RETRY");
    const fresh = (await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.id, item.id))))[0]!;
    expect(fresh.hintLevel).toBeGreaterThanOrEqual(2); // error ya conocido → ayuda más específica
    await requestHint(userId, item.id);
    await requestHint(userId, item.id); // nivel 4 → explicación
    await submitAttempt(userId, item.id, { response: { text: "El calcio se une a la tropomiosina otra vez" } });
    const errs = await withUser(userId, (tx) => tx.select().from(conceptErrors).where(eq(conceptErrors.conceptId, trop!.id)));
    expect(errs.find((e) => e.tag === "calcio-tropomiosina")!.count).toBeGreaterThanOrEqual(2);
    const stats = await getDashboardStats(userId);
    expect(stats.errors[0]!.count).toBeGreaterThanOrEqual(2);
  });

  it("acertar por reconocimiento no programa el repaso y obliga a recuperar sin opciones", async () => {
    const [mio] = await withUser(userId, (tx) => tx.select().from(concepts).where(eq(concepts.name, "Miosina")));
    const rec = (await withUser(userId, (tx) => tx.select().from(activities).where(and(eq(activities.conceptId, mio!.id), eq(activities.type, "RECOGNITION")))))[0];
    expect(rec).toBeDefined();
    const { sessionId } = await startSession(userId, { mode: "CONCEPT", conceptId: mio!.id });
    const item = (await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.sessionId, sessionId))))[0]!;
    // Sustituye el ítem por el de reconocimiento para probar el caso
    await withUser(userId, (tx) => tx.update(sessionItems).set({ activityId: rec!.id, state: "AWAITING_ANSWER", presentedAt: new Date() }).where(eq(sessionItems.id, item.id)));
    const r = await submitAttempt(userId, item.id, { response: { optionId: rec!.answerKey.correctOptionId }, confidence: 1 });
    expect(r.state).toBe("DONE");
    const [log] = await withUser(userId, (tx) => tx.select().from(reviewLogs).where(and(eq(reviewLogs.conceptId, mio!.id), eq(reviewLogs.activityType, "RECOGNITION"))));
    expect(log!.countsForSchedule).toBe(false);
    const all = await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.sessionId, sessionId)));
    expect(all.some((i) => i.reason.startsWith("Comprobación"))).toBe(true);
    const [m] = await withUser(userId, (tx) => tx.select().from(conceptMastery).where(eq(conceptMastery.conceptId, mio!.id)));
    expect(m!.state).not.toBe("MASTERED");
  });

  it("abandonar la sesión y volver: se reanuda en la misma actividad", async () => {
    const s1 = await startSession(userId, { mode: "DOCUMENT", documentId });
    const v1 = await getSessionView(userId, s1.sessionId);
    const s2 = await startSession(userId, { mode: "DOCUMENT", documentId });
    expect(s2).toEqual({ sessionId: s1.sessionId, resumed: true });
    const v2 = await getSessionView(userId, s2.sessionId);
    expect(v2.current!.itemId).toBe(v1.current!.itemId);
  });

  it("IA no disponible: evaluación provisional marcada y reevaluación posterior", async () => {
    const [ecc] = await withUser(userId, (tx) => tx.select().from(concepts).where(eq(concepts.name, "Acoplamiento excitación-contracción")));
    const act = (await withUser(userId, (tx) => tx.select().from(activities).where(and(eq(activities.conceptId, ecc!.id), eq(activities.type, "EXPLAIN")))))[0]!;
    const { sessionId } = await startSession(userId, { mode: "CONCEPT", conceptId: ecc!.id });
    const item = (await withUser(userId, (tx) => tx.select().from(sessionItems).where(eq(sessionItems.sessionId, sessionId))))[0]!;
    await withUser(userId, (tx) => tx.update(sessionItems).set({ activityId: act.id, state: "AWAITING_ANSWER", presentedAt: new Date() }).where(eq(sessionItems.id, item.id)));
    ai.down = true;
    const r = await submitAttempt(userId, item.id, { response: { text: "El calcio se une a la troponina y deja libre la actina" } });
    ai.down = false;
    expect(r.evaluation.provisional).toBe(true);
    expect(r.evaluation.feedback).toMatch(/provisional/);
    const [job] = await getDb().select().from(jobs).where(eq(jobs.type, "evaluation.reevaluate"));
    expect(job).toBeDefined();
    await getDb().update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, job!.id));
    await drainJobs();
    const evs = await withUser(userId, (tx) => tx.select().from(evaluations).where(eq(evaluations.method, "AI")));
    expect(evs.some((e) => e.result.feedback.startsWith("Reevaluado con IA"))).toBe(true);
  });

  it("el panel refleja datos reales y separa rendimiento inmediato del demorado", async () => {
    const s = await getDashboardStats(userId);
    expect(s.totalConcepts).toBe(3);
    expect(s.history.length).toBeGreaterThan(0);
    expect(s.retention.immediate.n).toBeGreaterThan(0);
    expect(s.retention.days7to30.n).toBe(0);
  });
});

describe("casos límite del procesamiento", () => {
  it("PDF sin texto extraíble y sin OCR disponible → error claro", async () => {
    setAiProviderForTests(null);
    const u = await makeUser();
    const lib = await createLibrary(u.id, { name: "L" });
    const doc = await createDocumentFromUpload(u.id, { libraryId: lib.id, rightsConfirmed: true }, { name: "escaneado.pdf", data: makePdf([[], []]) });
    await drainJobs();
    const d = await getDocument(u.id, doc.id);
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("NO_TEXT_NEEDS_OCR");
    expect(d.error).toMatch(/OCR/);
    setAiProviderForTests(ai);
  });

  it("sin IA el texto se extrae pero la auditoría queda pendiente (no se inventa verificación)", async () => {
    setAiProviderForTests(null);
    const u = await makeUser();
    const lib = await createLibrary(u.id, { name: "L" });
    const doc = await createDocumentFromUpload(u.id, { libraryId: lib.id, rightsConfirmed: true }, { name: "a.txt", data: Buffer.from("La glucólisis produce piruvato a partir de glucosa.") });
    await drainJobs();
    const d = await getDocument(u.id, doc.id);
    expect(d.status).toBe("EXTRACTED");
    expect(d.statusDetail).toMatch(/requiere IA/);
    const n = await withUser(u.id, (tx) => tx.select().from(claims));
    expect(n).toHaveLength(0);
    setAiProviderForTests(ai);
  });

  it("si la IA falla durante la auditoría se reintenta y, agotados los intentos, se marca como fallido y reanudable", async () => {
    const u = await makeUser();
    const lib = await createLibrary(u.id, { name: "L" });
    const doc = await createDocumentFromUpload(u.id, { libraryId: lib.id, rightsConfirmed: true }, { name: "b.txt", data: Buffer.from(MUSCLE_DOC) });
    ai.handlers["audit.verify_claims_backup"] = ai.handlers["audit.verify_claims"]!;
    ai.handlers["audit.verify_claims"] = () => {
      throw new Error("fallo de red simulado");
    };
    for (let i = 0; i < 6; i++) {
      await drainJobs();
      await getDb().update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "QUEUED"));
    }
    const d = await getDocument(u.id, doc.id);
    expect(d.status).toBe("FAILED");
    expect(d.errorCode).toBe("AUDIT_FAILED");
    // Lo ya extraído se conserva para reanudar
    const cl = await withUser(u.id, (tx) => tx.select().from(claims));
    expect(cl.length).toBeGreaterThan(0);
    ai.handlers["audit.verify_claims"] = ai.handlers["audit.verify_claims_backup"]!;
  });

  it("no se puede subir el mismo archivo dos veces a la misma biblioteca", async () => {
    const u = await makeUser();
    const lib = await createLibrary(u.id, { name: "L" });
    await createDocumentFromUpload(u.id, { libraryId: lib.id, rightsConfirmed: true }, { name: "c.txt", data: Buffer.from("Texto de prueba suficiente.") });
    await expect(createDocumentFromUpload(u.id, { libraryId: lib.id, rightsConfirmed: true }, { name: "c2.txt", data: Buffer.from("Texto de prueba suficiente.") })).rejects.toThrow(/ya está/);
  });

  it("un documento ajeno no es accesible", async () => {
    const other = await makeUser();
    await expect(getDocument(other.id, documentId)).rejects.toBeInstanceOf(NotFoundError);
    const d = await withUser(other.id, (tx) => tx.select().from(documents).where(eq(documents.id, documentId)));
    expect(d).toHaveLength(0);
  });
});
