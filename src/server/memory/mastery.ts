/**
 * Perfil de dominio multidimensional por concepto (funciones puras).
 * Ninguna respuesta aislada produce "dominio": hacen falta recuperaciones independientes
 * en días distintos, estabilidad suficiente y retención demostrada tras un intervalo.
 */
import type { ActivityType, MasteryState } from "@/db/schema";
import type { DimensionValue, MasteryDimensions } from "@/lib/types";

export const emptyDimensions = (): MasteryDimensions => ({
  freeRecall: { value: null, n: 0 },
  accuracy: { value: null, n: 0 },
  completeness: { value: null, n: 0 },
  discrimination: { value: null, n: 0 },
  application: { value: null, n: 0 },
  recognition: { value: null, n: 0 },
  hintIndependence: { value: null, n: 0 },
  delayedRetention: { value: null, n: 0 },
  errorCorrection: { value: null, n: 0 },
});

export const DIMENSION_LABELS: Record<keyof MasteryDimensions, string> = {
  freeRecall: "Recuerdo sin ayuda",
  accuracy: "Precisión",
  completeness: "Integridad del mecanismo",
  discrimination: "Distinguir conceptos similares",
  application: "Aplicación a casos nuevos",
  recognition: "Reconocimiento",
  hintIndependence: "Independencia de pistas",
  delayedRetention: "Retención tras un intervalo",
  errorCorrection: "Corrección de errores",
};

function ema(d: DimensionValue, x: number, weight = 1): DimensionValue {
  const alpha = Math.max(0.3, 1 / (d.n + 1)) * weight;
  const value = d.value === null ? x : d.value + alpha * (x - d.value);
  return { value: Math.round(value * 1000) / 1000, n: d.n + 1 };
}

export interface Observation {
  activityType: ActivityType;
  firstScore: number;
  finalScore: number;
  hintsUsed: number;
  elapsedDays: number;
  criticalErrorCount: number;
  confusedWithOther: boolean;
  /** true si hubo errores en el primer intento y luego se corrigieron. */
  hadErrorsThenCorrected: boolean | null;
  /** Evaluación provisional (sin IA): pesa la mitad. */
  provisional: boolean;
}

const OPEN: ActivityType[] = ["FREE_RECALL", "EXPLAIN", "PREDICTION", "CASE", "RELATION"];

export function updateDimensions(prev: MasteryDimensions, o: Observation): MasteryDimensions {
  const d: MasteryDimensions = { ...emptyDimensions(), ...prev };
  const w = o.provisional ? 0.5 : 1;
  const independent = o.hintsUsed === 0;
  if (o.activityType === "RECOGNITION") {
    d.recognition = ema(d.recognition, o.firstScore, w);
    d.discrimination = ema(d.discrimination, o.confusedWithOther ? 0 : o.firstScore, w * 0.5);
    return d;
  }
  if (o.activityType === "FREE_RECALL" || o.activityType === "EXPLAIN") {
    d.freeRecall = ema(d.freeRecall, independent ? o.firstScore : o.firstScore * 0.5, w);
  }
  if (OPEN.includes(o.activityType)) {
    d.accuracy = ema(d.accuracy, Math.max(0, 1 - 0.5 * o.criticalErrorCount), w);
    d.completeness = ema(d.completeness, o.firstScore, w);
  }
  if (o.activityType === "PROCESS_ORDER") d.completeness = ema(d.completeness, o.firstScore, w);
  if (o.activityType === "CLOZE") d.freeRecall = ema(d.freeRecall, independent ? o.firstScore * 0.8 : o.firstScore * 0.4, w * 0.6);
  if (o.activityType === "CASE" || o.activityType === "PREDICTION") d.application = ema(d.application, o.firstScore, w);
  if (o.activityType === "RELATION" || o.confusedWithOther) d.discrimination = ema(d.discrimination, o.confusedWithOther ? 0 : o.firstScore, w);
  d.hintIndependence = ema(d.hintIndependence, independent ? 1 : Math.max(0, 1 - o.hintsUsed / 4), w);
  if (o.elapsedDays >= 1 && independent) d.delayedRetention = ema(d.delayedRetention, o.firstScore, w);
  if (o.hadErrorsThenCorrected !== null) d.errorCorrection = ema(d.errorCorrection, o.hadErrorsThenCorrected ? 1 : 0, w);
  return d;
}

export interface StateInput {
  dims: MasteryDimensions;
  stability: number;
  reps: number;
  lastGrade: number | null;
  previous: MasteryState;
  independentSuccessDays: string[];
  unresolvedRecurringErrors: number;
}

export function deriveState(s: StateInput): MasteryState {
  if (s.reps === 0 && s.dims.recognition.n === 0) return "NEW";
  const fr = s.dims.freeRecall.value;
  if (s.lastGrade === 1 && (s.previous === "CONSOLIDATING" || s.previous === "MASTERED" || s.previous === "RELEARNING")) return "RELEARNING";
  const mastered =
    fr !== null &&
    fr >= 0.8 &&
    (s.dims.hintIndependence.value ?? 0) >= 0.75 &&
    s.independentSuccessDays.length >= 2 &&
    s.stability >= 7 &&
    (s.dims.delayedRetention.value ?? 0) >= 0.75 &&
    (s.dims.application.value === null || s.dims.application.value >= 0.6) &&
    s.unresolvedRecurringErrors === 0;
  if (mastered) return "MASTERED";
  if (fr !== null && fr >= 0.6 && (s.lastGrade ?? 0) >= 2 && s.reps >= 2) return "CONSOLIDATING";
  return "LEARNING";
}

/** Falsa sensación de aprendizaje: reconoce pero no recupera sin ayuda. */
export function illusionOfCompetence(d: MasteryDimensions): boolean {
  const rec = d.recognition.value;
  const fr = d.freeRecall.value;
  return rec !== null && rec >= 0.8 && fr !== null && fr < 0.5;
}

/** Índice orientativo 0–100 del rendimiento observado (no una medida de la memoria biológica). */
export function masteryIndex(d: MasteryDimensions, state: MasteryState): number | null {
  const parts: [number | null, number][] = [
    [d.freeRecall.value, 3],
    [d.completeness.value, 2],
    [d.accuracy.value, 2],
    [d.application.value, 1.5],
    [d.discrimination.value, 1],
    [d.hintIndependence.value, 1.5],
    [d.delayedRetention.value, 2.5],
  ];
  const avail = parts.filter(([v]) => v !== null) as [number, number][];
  const recallEvidence = d.freeRecall.value !== null || d.completeness.value !== null || d.application.value !== null;
  if (!recallEvidence) return d.recognition.value !== null ? Math.round(Math.min(0.3, d.recognition.value * 0.3) * 100) : null;
  const val = avail.reduce((a, [v, w]) => a + v * w, 0) / avail.reduce((a, [, w]) => a + w, 0);
  const cap = state === "MASTERED" ? 1 : state === "CONSOLIDATING" ? 0.85 : 0.7;
  return Math.round(Math.min(cap, val) * 100);
}
