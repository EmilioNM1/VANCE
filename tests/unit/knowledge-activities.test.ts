import { describe, expect, it } from "vitest";
import { validateKnowledge } from "@/server/knowledge/build";
import { buildCloze, buildProcessOrder, buildRecognition, selectActivityTypes, validateGeneratedActivity } from "@/server/activities/generate";
import { chooseActivity, interleave } from "@/server/study/session";
import { emptyDimensions } from "@/server/memory/mastery";

const concept = (o: Partial<{ name: string; kind: string; steps: number }>) => ({
  key: "K1",
  name: o.name ?? "Contracción",
  kind: (o.kind ?? "PROCESS") as "PROCESS",
  summary: "s",
  importance: 3,
  claimRefs: ["C1"],
  keyTerms: [],
  steps: Array.from({ length: o.steps ?? 0 }, (_, i) => ({ text: `paso ${i}`, claimRefs: [i === 1 ? "C99" : "C1"] })),
  formula: null,
  components: [],
  examples: [],
  exceptions: [],
  misconceptions: [],
  applications: [],
});

describe("motor de conocimiento", () => {
  it("descarta conceptos, pasos y relaciones sin afirmaciones validadas", () => {
    const refs = new Map([["C1", "claim-1"]]);
    const out = validateKnowledge(
      {
        concepts: [concept({ steps: 3 }), { ...concept({ name: "Inventado" }), key: "K2", claimRefs: ["C77"] }],
        relations: [
          { from: "K1", to: "K2", type: "CAUSES", description: "x", claimRefs: ["C1"] },
          { from: "K1", to: "K1", type: "CAUSES", description: "x", claimRefs: ["C1"] },
        ],
      },
      refs,
    );
    expect(out.concepts.map((c) => c.name)).toEqual(["Contracción"]);
    expect(out.concepts[0]!.details.steps).toHaveLength(2); // el paso con C99 se descarta
    expect(out.relations).toHaveLength(0);
    expect(out.dropped.join(" ")).toMatch(/Inventado/);
  });
});

describe("generación de actividades", () => {
  it("elige actividades según la naturaleza del concepto", () => {
    expect(selectActivityTypes({ kind: "MECHANISM", details: { steps: [{ text: "a", claimIds: [] }, { text: "b", claimIds: [] }, { text: "c", claimIds: [] }] } }, false)).toEqual(
      expect.arrayContaining(["EXPLAIN", "PROCESS_ORDER", "PREDICTION", "CASE"]),
    );
    expect(selectActivityTypes({ kind: "CLASSIFICATION", details: {} }, false)).toContain("RELATION");
    expect(selectActivityTypes({ kind: "DEFINITION", details: {} }, false)[0]).toBe("FREE_RECALL");
    // El reconocimiento siempre es complementario (al final)
    const t = selectActivityTypes({ kind: "DEFINITION", details: {} }, true);
    expect(t[t.length - 1]).toBe("RECOGNITION");
  });

  it("reconstrucción de procesos: desordena y guarda la clave solo en servidor", () => {
    const a = buildProcessOrder(
      { id: "c1", name: "Contracción", details: { steps: ["A", "B", "C", "D"].map((t) => ({ text: t, claimIds: ["k"] })) } },
      new Map([["k", "chunk"]]),
    )!;
    expect(a.answerKey!.order).toEqual(["s1", "s2", "s3", "s4"]);
    expect(a.payload!.items!.map((i) => i.id)).not.toEqual(["s1", "s2", "s3", "s4"]);
    expect(JSON.stringify(a.payload)).not.toContain("order");
    expect(a.chunkIds).toEqual(["chunk"]);
  });

  it("completar huecos oculta términos del concepto en una afirmación validada", () => {
    const a = buildCloze({ id: "c1", name: "troponina", details: { keyTerms: ["calcio"] } }, [{ id: "k1", text: "El calcio se une a la troponina C y cambia su forma.", chunkId: "ch" }])!;
    const segs = a.payload!.segments!;
    expect(segs.filter((s) => s.type === "blank")).toHaveLength(2);
    expect(JSON.stringify(segs)).not.toMatch(/troponina|calcio/);
    expect(a.prompt).not.toMatch(/troponina/i);
  });

  it("reconocimiento requiere distractores reales", () => {
    expect(buildRecognition({ id: "c1", name: "A", summary: "A hace algo", kind: "CONCEPT" }, [], [{ id: "k", text: "t", chunkId: "x" }])).toBeNull();
    const r = buildRecognition({ id: "c1", name: "Troponina", summary: "La troponina fija calcio", kind: "CONCEPT" }, [
      { id: "c2", name: "Tropomiosina", kind: "CONCEPT" },
      { id: "c3", name: "Actina", kind: "CONCEPT" },
    ], [{ id: "k", text: "t", chunkId: "x" }])!;
    expect(r.prompt).not.toMatch(/troponina/i);
    expect(r.prompt).toContain("____");
  });

  it("una actividad generada sin fuente válida se rechaza", () => {
    const base = {
      conceptKey: "K1",
      type: "FREE_RECALL" as const,
      prompt: "Explica",
      scenario: null,
      relatedConceptKeys: [],
      referenceAnswer: "r",
      essentialElements: [{ description: "Aspecto", keyTerms: [], weight: 1, claimRefs: ["C9"] }],
      relationElements: [],
      criticalErrors: [],
      optionalElements: [],
      precision: "CONCEPTUAL" as const,
      hints: ["1", "2", "3"],
      explanation: "e",
      claimRefs: ["C9"],
    };
    const ctx = { conceptId: "c1", refToClaim: new Map([["C1", { id: "claim1", text: "t", chunkId: "ch1" }]]), keyToConceptId: new Map() };
    const bad = validateGeneratedActivity(base, ctx);
    expect(bad.ok).toBe(false);
    const good = validateGeneratedActivity({ ...base, claimRefs: ["C1"], essentialElements: [{ ...base.essentialElements[0]!, claimRefs: ["C1"] }] }, ctx);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.activity.claimIds).toEqual(["claim1"]);
      expect(good.activity.chunkIds).toEqual(["ch1"]);
    }
  });
});

describe("planificación de sesiones", () => {
  const acts = [
    { id: "r", type: "RECOGNITION" as const },
    { id: "f", type: "FREE_RECALL" as const },
    { id: "c", type: "CASE" as const },
    { id: "p", type: "PROCESS_ORDER" as const },
  ];
  it("un concepto nuevo empieza con recuperación libre, no con opción múltiple", () => {
    expect(chooseActivity(acts, null, { recentTypes: [], recurringError: false, confused: false })!.type).toBe("FREE_RECALL");
  });
  it("si solo reconoce pero no recuerda, prioriza recuerdo libre", () => {
    const m = { state: "LEARNING" as const, dimensions: emptyDimensions(), illusionFlag: true, reps: 2 };
    expect(chooseActivity(acts, m, { recentTypes: [], recurringError: false, confused: false })!.type).toBe("FREE_RECALL");
  });
  it("si la aplicación es débil, propone un caso", () => {
    const d = emptyDimensions();
    d.freeRecall = { value: 0.9, n: 3 };
    d.application = { value: 0.3, n: 1 };
    const m = { state: "CONSOLIDATING" as const, dimensions: d, illusionFlag: false, reps: 3 };
    expect(chooseActivity(acts, m, { recentTypes: [], recurringError: false, confused: false })!.type).toBe("CASE");
  });
  it("intercala conceptos y documentos", () => {
    const out = interleave([
      { conceptId: "a", documentId: "d1" },
      { conceptId: "b", documentId: "d1" },
      { conceptId: "c", documentId: "d2" },
    ]);
    expect(out.map((o) => o.documentId)).toEqual(["d1", "d2", "d1"]);
  });
});
