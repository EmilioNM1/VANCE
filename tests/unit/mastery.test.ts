import { describe, expect, it } from "vitest";
import { deriveState, emptyDimensions, illusionOfCompetence, masteryIndex, updateDimensions, type Observation } from "@/server/memory/mastery";

const obs = (o: Partial<Observation>): Observation => ({
  activityType: "FREE_RECALL",
  firstScore: 1,
  finalScore: 1,
  hintsUsed: 0,
  elapsedDays: 0,
  criticalErrorCount: 0,
  confusedWithOther: false,
  hadErrorsThenCorrected: null,
  provisional: false,
  ...o,
});

describe("perfil de dominio", () => {
  it("una única respuesta correcta no produce dominio", () => {
    const dims = updateDimensions(emptyDimensions(), obs({}));
    const state = deriveState({ dims, stability: 3, reps: 1, lastGrade: 4, previous: "NEW", independentSuccessDays: ["2026-01-01"], unresolvedRecurringErrors: 0 });
    expect(state).not.toBe("MASTERED");
    expect(masteryIndex(dims, state)!).toBeLessThanOrEqual(70);
  });

  it("reconocer en opción múltiple sin poder explicarlo se detecta como falsa sensación de aprendizaje", () => {
    let d = updateDimensions(emptyDimensions(), obs({ activityType: "RECOGNITION", firstScore: 1 }));
    d = updateDimensions(d, obs({ activityType: "RECOGNITION", firstScore: 1 }));
    expect(illusionOfCompetence(d)).toBe(false); // aún no hay recuerdo libre
    d = updateDimensions(d, obs({ activityType: "FREE_RECALL", firstScore: 0.2 }));
    expect(illusionOfCompetence(d)).toBe(true);
  });

  it("el reconocimiento por sí solo no supera un índice bajo", () => {
    const d = updateDimensions(emptyDimensions(), obs({ activityType: "RECOGNITION", firstScore: 1 }));
    expect(masteryIndex(d, "LEARNING")!).toBeLessThanOrEqual(30);
  });

  it("el dominio exige recuerdos independientes en días distintos, estabilidad y retención demorada", () => {
    let d = emptyDimensions();
    d = updateDimensions(d, obs({}));
    d = updateDimensions(d, obs({ elapsedDays: 3 }));
    d = updateDimensions(d, obs({ elapsedDays: 8 }));
    expect(deriveState({ dims: d, stability: 12, reps: 3, lastGrade: 4, previous: "CONSOLIDATING", independentSuccessDays: ["a"], unresolvedRecurringErrors: 0 })).not.toBe("MASTERED");
    expect(deriveState({ dims: d, stability: 12, reps: 3, lastGrade: 4, previous: "CONSOLIDATING", independentSuccessDays: ["a", "b"], unresolvedRecurringErrors: 0 })).toBe("MASTERED");
    expect(deriveState({ dims: d, stability: 12, reps: 3, lastGrade: 4, previous: "CONSOLIDATING", independentSuccessDays: ["a", "b"], unresolvedRecurringErrors: 1 })).not.toBe("MASTERED");
  });

  it("usar pistas reduce la independencia", () => {
    const d = updateDimensions(emptyDimensions(), obs({ hintsUsed: 3, firstScore: 0.3, finalScore: 0.9 }));
    expect(d.hintIndependence.value!).toBeLessThan(0.5);
  });

  it("olvidar algo que estaba en consolidación pasa a reaprendizaje", () => {
    expect(deriveState({ dims: emptyDimensions(), stability: 1, reps: 5, lastGrade: 1, previous: "CONSOLIDATING", independentSuccessDays: [], unresolvedRecurringErrors: 0 })).toBe("RELEARNING");
  });
});
