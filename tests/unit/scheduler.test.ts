import { describe, expect, it } from "vitest";
import { calibrationFactor, gradeFromOutcome, retrievability, schedule, updateCalibration, type MemoryState } from "@/server/memory/scheduler";
import { DEFAULT_SETTINGS } from "@/lib/types";

const fresh: MemoryState = { stability: 0, difficulty: 5, reps: 0, lapses: 0, lastReviewedAt: null };
const now = new Date("2026-01-10T10:00:00Z");
const base = { activityType: "FREE_RECALL" as const, finalScore: 1, explanationShown: false, confidence: null, recurringError: false, ambiguous: false };

describe("calificación a partir del resultado", () => {
  it("recuerdo completo sin pistas = fácil", () => {
    expect(gradeFromOutcome({ ...base, firstScore: 0.95, hintsUsed: 0 })).toBe(4);
  });
  it("con pistas nunca se considera recuerdo fluido", () => {
    expect(gradeFromOutcome({ ...base, firstScore: 0.3, finalScore: 0.9, hintsUsed: 1 })).toBe(2);
    expect(gradeFromOutcome({ ...base, firstScore: 0.3, finalScore: 0.9, hintsUsed: 3 })).toBe(1);
  });
  it("necesitar la explicación completa cuenta como olvido", () => {
    expect(gradeFromOutcome({ ...base, firstScore: 0.2, hintsUsed: 4, explanationShown: true })).toBe(1);
  });
  it("acierto con confianza mínima (posible casualidad) no se premia como fácil", () => {
    expect(gradeFromOutcome({ ...base, firstScore: 1, hintsUsed: 0, confidence: 1 })).toBe(2);
  });
  it("un error conceptual recurrente limita la calificación", () => {
    expect(gradeFromOutcome({ ...base, firstScore: 0.9, hintsUsed: 0, recurringError: true })).toBe(2);
  });
});

describe("programación de repasos", () => {
  it("usa los intervalos iniciales configurables", () => {
    const s = { ...DEFAULT_SETTINGS, initialIntervalsDays: { again: 0.01, hard: 2, good: 5, easy: 9 } };
    expect(schedule(fresh, 3, now, s).intervalDays).toBeCloseTo(5, 5);
    expect(schedule(fresh, 4, now, s).intervalDays).toBeCloseTo(9, 5);
  });
  it("repasar demasiado pronto apenas aumenta la estabilidad (efecto de espaciado)", () => {
    const first = schedule(fresh, 3, now, DEFAULT_SETTINGS).state;
    const early = schedule(first, 3, new Date(now.getTime() + 3600_000), DEFAULT_SETTINGS).state;
    const onTime = schedule(first, 3, new Date(now.getTime() + 3 * 86400_000), DEFAULT_SETTINGS).state;
    expect(onTime.stability).toBeGreaterThan(early.stability * 1.5);
  });
  it("los conceptos recuperados varias veces se espacian progresivamente", () => {
    let st = fresh;
    let t = now;
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = schedule(st, 3, t, DEFAULT_SETTINGS);
      intervals.push(r.intervalDays);
      st = r.state;
      t = r.dueAt;
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
  });
  it("un olvido reduce la estabilidad y reaparece pronto", () => {
    const st: MemoryState = { stability: 20, difficulty: 5, reps: 4, lapses: 0, lastReviewedAt: now };
    const r = schedule(st, 1, new Date(now.getTime() + 20 * 86400_000), DEFAULT_SETTINGS);
    expect(r.state.stability).toBeLessThan(7);
    expect(r.intervalDays).toBeLessThanOrEqual(1);
    expect(r.state.lapses).toBe(1);
  });
  it("R(t) decrece con el tiempo", () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 2);
    expect(retrievability(30, 5)).toBeLessThan(0.7);
  });
});

describe("calibración personal", () => {
  it("si el usuario recuerda menos de lo previsto, se acortan los intervalos", () => {
    let c = DEFAULT_SETTINGS.calibration;
    for (let i = 0; i < 20; i++) c = updateCalibration(c, 0.9, i % 2 === 0);
    expect(calibrationFactor(c)).toBeLessThan(1);
    const s1 = schedule({ stability: 10, difficulty: 5, reps: 3, lapses: 0, lastReviewedAt: now }, 3, new Date(now.getTime() + 10 * 86400_000), DEFAULT_SETTINGS);
    const s2 = schedule({ stability: 10, difficulty: 5, reps: 3, lapses: 0, lastReviewedAt: now }, 3, new Date(now.getTime() + 10 * 86400_000), { ...DEFAULT_SETTINGS, calibration: c });
    expect(s2.intervalDays).toBeLessThan(s1.intervalDays);
  });
  it("sin datos suficientes no se ajusta", () => {
    expect(calibrationFactor({ n: 3, predicted: 2.7, observed: 0 })).toBe(1);
  });
});
