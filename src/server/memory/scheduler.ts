/**
 * Motor de repetición espaciada (independiente del resto de la app, funciones puras).
 *
 * Modelo inspirado en FSRS: cada concepto tiene una estabilidad S (días hasta que la
 * probabilidad de recuerdo cae al 90 %) y una dificultad D (1–10). La probabilidad de
 * recuerdo tras t días es R(t) = (1 + t / (9·S))^-1.
 * - Recuperar con éxito cuando R ya ha bajado aumenta más S (efecto de espaciado).
 * - Un fallo (lapso) reduce S drásticamente.
 * - La calificación (1–4) no sale solo del acierto: incorpora pistas, explicación necesaria,
 *   confianza declarada y errores conceptuales recurrentes.
 * - Los intervalos iniciales son configurables y un factor de calibración personal ajusta los
 *   intervalos según si el usuario recuerda más o menos de lo que el modelo predice.
 */
import type { ActivityType } from "@/db/schema";
import type { UserSettings } from "@/lib/types";

export type Grade = 1 | 2 | 3 | 4;

export interface MemoryState {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewedAt: Date | null;
}

export interface GradeInput {
  activityType: ActivityType;
  /** Puntuación del primer intento (recuperación independiente). */
  firstScore: number;
  finalScore: number;
  /** Nivel máximo de pista usado (0–4). */
  hintsUsed: number;
  explanationShown: boolean;
  /** Confianza declarada antes de ver el resultado (1–4) o null. */
  confidence: number | null;
  recurringError: boolean;
  ambiguous: boolean;
}

export const DAY = 86400_000;

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + Math.max(0, elapsedDays) / (9 * stability), -1);
}

export function gradeFromOutcome(g: GradeInput): Grade {
  if (g.explanationShown) return 1;
  let grade: Grade;
  if (g.hintsUsed === 0) {
    if (g.firstScore >= 0.9) grade = 4;
    else if (g.firstScore >= 0.75) grade = 3;
    else if (g.firstScore >= 0.5) grade = 2;
    else grade = 1;
  } else {
    // Con pistas nunca se considera una recuperación fluida
    grade = g.finalScore >= 0.75 && g.hintsUsed <= 2 ? 2 : 1;
  }
  // Acierto con baja confianza: posible acierto casual → no se premia como fácil
  if (g.confidence !== null && g.confidence <= 1 && grade >= 3) grade = 2;
  if (g.confidence !== null && g.confidence === 2 && grade === 4) grade = 3;
  if (g.recurringError) grade = Math.min(grade, 2) as Grade;
  if (g.ambiguous) grade = Math.max(grade, 2) as Grade;
  return grade;
}

/** El reconocimiento (opción múltiple) no programa repasos por sí solo. */
export function countsForSchedule(type: ActivityType) {
  return type !== "RECOGNITION";
}

export function calibrationFactor(c: UserSettings["calibration"]): number {
  if (c.n < 10 || c.predicted <= 0) return 1;
  // Si el usuario recuerda menos de lo predicho, se acortan los intervalos (y viceversa)
  return Math.min(1.5, Math.max(0.6, c.observed / c.predicted));
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface ScheduleResult {
  state: MemoryState;
  intervalDays: number;
  dueAt: Date;
  elapsedDays: number;
  predictedRecall: number | null;
}

export function schedule(prev: MemoryState, grade: Grade, now: Date, settings: UserSettings): ScheduleResult {
  const elapsedDays = prev.lastReviewedAt ? Math.max(0, (now.getTime() - prev.lastReviewedAt.getTime()) / DAY) : 0;
  const first = prev.reps === 0 || prev.stability <= 0;
  const R = first ? null : retrievability(elapsedDays, prev.stability);
  const init = settings.initialIntervalsDays;
  let S: number;
  let D: number;
  let lapses = prev.lapses;

  if (first) {
    S = [init.again, init.hard, init.good, init.easy][grade - 1]!;
    D = clamp(5 - (grade - 3) * 1.5, 1, 10);
    if (grade === 1) lapses++;
  } else {
    D = clamp(prev.difficulty - 0.8 * (grade - 3), 1, 10);
    D = 0.9 * D + 0.1 * 5; // reversión a la media
    if (grade === 1) {
      lapses++;
      S = Math.max(init.again, Math.min(prev.stability * 0.3, 0.5 + prev.stability * 0.15));
    } else {
      const r = R ?? 1;
      const mult = grade === 2 ? 0.5 : grade === 4 ? 1.6 : 1;
      const growth = Math.exp(1.1) * (11 - D) * Math.pow(prev.stability, -0.15) * (Math.exp((1 - r) * 1.4) - 1) * mult;
      S = prev.stability * (1 + Math.max(0, growth));
      if (grade === 2) S = Math.max(S, prev.stability * 1.05);
      else S = Math.max(S, prev.stability * 1.2);
    }
  }
  S = clamp(S, 0.005, 3650);
  const r = clamp(settings.desiredRetention, 0.7, 0.97);
  let interval = S * 9 * (1 / r - 1) * calibrationFactor(settings.calibration);
  if (grade === 1) interval = Math.min(interval, 1);
  interval = clamp(interval, 0.005, 365);
  return {
    state: { stability: S, difficulty: D, reps: prev.reps + 1, lapses, lastReviewedAt: now },
    intervalDays: interval,
    dueAt: new Date(now.getTime() + interval * DAY),
    elapsedDays,
    predictedRecall: R,
  };
}

export function updateCalibration(c: UserSettings["calibration"], predicted: number | null, success: boolean): UserSettings["calibration"] {
  if (predicted === null) return c;
  // Ventana deslizante aproximada: decae el peso del historial antiguo
  const decay = c.n >= 100 ? 0.99 : 1;
  return { n: Math.min(100, c.n + 1), predicted: c.predicted * decay + predicted, observed: c.observed * decay + (success ? 1 : 0) };
}
