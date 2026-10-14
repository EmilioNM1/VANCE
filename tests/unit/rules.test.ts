import { describe, expect, it } from "vitest";
import { evaluateCloze, evaluateOrder, evaluateRecognition, termMatches } from "@/server/evaluation/rules";
import type { Rubric } from "@/lib/types";

const rubric: Rubric = { referenceAnswer: "", essentialElements: [], relations: [], criticalErrors: [], optionalElements: [], precision: "EXACT", hints: ["a", "b", "c"], explanation: "exp" };

describe("evaluación determinista", () => {
  it("orden correcto = 1, un intercambio adyacente da crédito parcial", () => {
    const key = { order: ["a", "b", "c", "d", "e"] };
    const items = new Map();
    expect(evaluateOrder(["a", "b", "c", "d", "e"], key, rubric, items).score).toBe(1);
    const r = evaluateOrder(["a", "c", "b", "d", "e"], key, rubric, items);
    expect(r.score).toBeGreaterThan(0.6);
    expect(r.score).toBeLessThan(1);
    expect(r.verdict).not.toBe("CORRECT");
  });
  it("orden invertido puntúa muy bajo", () => {
    expect(evaluateOrder(["e", "d", "c", "b", "a"], { order: ["a", "b", "c", "d", "e"] }, rubric, new Map()).score).toBeLessThan(0.2);
  });
  it("rechaza respuestas manipuladas (pasos repetidos o inexistentes)", () => {
    expect(evaluateOrder(["a", "a", "b"], { order: ["a", "b", "c"] }, rubric, new Map()).score).toBe(0);
    expect(evaluateOrder(["a", "b", "x"], { order: ["a", "b", "c"] }, rubric, new Map()).score).toBe(0);
  });
  it("huecos: tolera erratas menores y tildes, pero no en cifras", () => {
    expect(termMatches("tropomiosina", "Tropomiosina")).toBe("EXACT");
    expect(termMatches("tropomiocina", "tropomiosina")).toBe("TYPO");
    expect(termMatches("acetilcolína", "acetilcolina")).toBe("EXACT");
    expect(termMatches("-70 mv", "-90 mV")).toBe("NO");
    const r = evaluateCloze({ b1: "troponina", b2: "" }, { blanks: { b1: { answer: "troponina", accept: [] }, b2: { answer: "calcio", accept: ["Ca2+"] } } }, rubric);
    expect(r.score).toBe(0.5);
    expect(r.missing).toEqual(["Hueco 2"]);
  });
  it("acepta sinónimos definidos", () => {
    const r = evaluateCloze({ b1: "Ca2+" }, { blanks: { b1: { answer: "calcio", accept: ["Ca2+"] } } }, rubric);
    expect(r.score).toBe(1);
  });
  it("reconocimiento registra la confusión con el concepto elegido", () => {
    const key = { correctOptionId: "o1", optionConceptIds: { o1: "c1", o2: "c2" } };
    expect(evaluateRecognition("o1", key, rubric).score).toBe(1);
    expect(evaluateRecognition("o2", key, rubric).confusedWithConceptIds).toEqual(["c2"]);
  });
});
