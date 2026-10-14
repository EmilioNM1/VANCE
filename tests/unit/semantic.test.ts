import { describe, expect, it } from "vitest";
import { heuristicEvaluate, scoreFromElements, toResult } from "@/server/evaluation/semantic";
import type { Rubric } from "@/lib/types";

const rubric: Rubric = {
  referenceAnswer: "El calcio se une a la troponina C, que desplaza la tropomiosina y expone los sitios de unión de la actina.",
  essentialElements: [
    { id: "e1", description: "Ion desencadenante", keyTerms: ["calcio", "Ca2+"], weight: 2, claimIds: ["c1"] },
    { id: "e2", description: "Proteína a la que se une", keyTerms: ["troponina"], weight: 1, claimIds: ["c1"] },
    { id: "e3", description: "Efecto sobre la tropomiosina", keyTerms: ["tropomiosina"], weight: 1, claimIds: ["c2"] },
  ],
  relations: [{ id: "r1", description: "Consecuencia sobre la actina", keyTerms: ["actina"], weight: 2, claimIds: ["c2"] }],
  criticalErrors: [{ id: "x1", description: "Afirma que el calcio se une a la tropomiosina", tag: "calcio-tropomiosina" }],
  optionalElements: [],
  precision: "CONCEPTUAL",
  hints: ["h1", "h2", "h3"],
  explanation: "expl",
};

const evalData = (statuses: Record<string, "PRESENT" | "PARTIAL" | "ABSENT" | "INCORRECT">, extra: Partial<Parameters<typeof toResult>[1]> = {}) => ({
  elements: Object.entries(statuses).map(([id, status]) => ({ id, status, evidence: "", note: "" })),
  criticalErrors: [],
  incorrectStatements: [],
  ambiguous: false,
  ambiguityNote: "",
  confusedWithConcepts: [],
  feedback: "fb",
  nextHint: "pista",
  explanation: "exp",
  nextRecommendation: "",
  ...extra,
});

describe("evaluación semántica", () => {
  it("la nota se calcula en servidor con crédito parcial ponderado", () => {
    const r = toResult(rubric, evalData({ e1: "PRESENT", e2: "PARTIAL", e3: "ABSENT", r1: "PRESENT" }), []);
    // (2 + 0.5 + 0 + 2) / 6 = 0.75
    expect(r.score).toBe(0.75);
    expect(r.verdict).toBe("PARTIAL");
    expect(r.missing).toEqual(["Efecto sobre la tropomiosina"]);
  });
  it("una respuesta parcialmente correcta recibe crédito parcial, no cero", () => {
    const r = toResult(rubric, evalData({ e1: "PRESENT", e2: "PRESENT" }), []);
    expect(r.score).toBe(0.5);
  });
  it("los errores conceptuales graves penalizan y conservan la etiqueta prevista", () => {
    const r = toResult(rubric, evalData({ e1: "PRESENT", e2: "PRESENT", e3: "PRESENT", r1: "PRESENT" }, { criticalErrors: [{ rubricId: "x1", tag: "otro", description: "d" }] }), []);
    expect(r.score).toBe(0.8);
    expect(r.criticalErrors[0]!.tag).toBe("calcio-tropomiosina");
  });
  it("si hay ambigüedad legítima no se penaliza arbitrariamente", () => {
    const r = toResult(rubric, evalData({ e1: "PRESENT", e2: "PRESENT", e3: "PRESENT", r1: "PRESENT" }, { ambiguous: true, ambiguityNote: "discrepancia", criticalErrors: [{ rubricId: null, tag: "x", description: "d" }] }), []);
    expect(r.verdict).toBe("AMBIGUOUS");
    expect(r.score).toBe(1);
  });
  it("ignora elementos inventados por el modelo que no están en la rúbrica", () => {
    expect(scoreFromElements(rubric, new Map([["zz", "PRESENT"]]), 0, false)).toBe(0);
  });
  it("identifica confusiones con otros conceptos del tema", () => {
    const r = toResult(rubric, evalData({}, { confusedWithConcepts: ["Tropomiosina"] }), [{ id: "k1", name: "tropomiosina" }]);
    expect(r.confusedWithConceptIds).toEqual(["k1"]);
  });
  it("la evaluación provisional sin IA usa términos clave y lo declara", () => {
    const r = heuristicEvaluate(rubric, "El Ca2+ se une a la troponina y entonces se mueve");
    expect(r.score).toBeCloseTo(0.5, 2);
    expect(r.feedback).toMatch(/provisional/);
  });
});
