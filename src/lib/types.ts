/** Tipos compartidos entre servidor y cliente. Nada de aquí debe contener secretos. */

export interface RubricElement {
  id: string;
  /** Etiqueta del aspecto evaluado, redactada para no revelar la respuesta (p. ej. "Papel del calcio"). */
  description: string;
  /** Términos clave o sinónimos aceptables (solo servidor). */
  keyTerms: string[];
  weight: number;
  claimIds: string[];
}

export interface RubricCriticalError {
  id: string;
  description: string;
  /** Etiqueta estable de error conceptual (p. ej. "calcio-se-une-a-tropomiosina"). */
  tag: string;
}

export interface Rubric {
  referenceAnswer: string;
  essentialElements: RubricElement[];
  relations: RubricElement[];
  criticalErrors: RubricCriticalError[];
  optionalElements: string[];
  precision: "CONCEPTUAL" | "EXACT";
  /** Pistas predefinidas niveles 1–3 (respaldo si la IA no puede generar una adaptativa). */
  hints: [string, string, string];
  /** Explicación completa (nivel 4). */
  explanation: string;
}

export interface ProcessItem {
  id: string;
  text: string;
}

export type ClozeSegment = { type: "text"; text: string } | { type: "blank"; id: string; length: number };

export interface ActivityPayload {
  scenario?: string;
  conceptNames?: string[];
  items?: ProcessItem[];
  askJustification?: boolean;
  segments?: ClozeSegment[];
  options?: { id: string; text: string }[];
  minWords?: number;
  /** Instrucción breve de cómo responder. */
  instructions?: string;
}

export interface AnswerKey {
  order?: string[];
  blanks?: Record<string, { answer: string; accept: string[] }>;
  correctOptionId?: string;
  optionConceptIds?: Record<string, string>;
}

export interface ConceptStep {
  text: string;
  claimIds: string[];
}

export interface ConceptDetails {
  keyTerms?: string[];
  steps?: ConceptStep[];
  formula?: { expression: string; variables: { symbol: string; meaning: string }[] };
  components?: string[];
  examples?: string[];
  exceptions?: string[];
  misconceptions?: string[];
  applications?: string[];
}

export type ElementStatus = "PRESENT" | "PARTIAL" | "ABSENT" | "INCORRECT";

export interface EvaluationResult {
  score: number;
  verdict: "CORRECT" | "PARTIAL" | "INCORRECT" | "AMBIGUOUS";
  elements: { id: string; label: string; status: ElementStatus; note?: string }[];
  correct: string[];
  incorrect: { description: string; explanation?: string }[];
  /** Aspectos omitidos (etiquetas, no respuestas). */
  missing: string[];
  criticalErrors: { tag: string; description: string }[];
  ambiguityNote?: string;
  feedback: string;
  /** Pista adaptativa sugerida para el siguiente nivel (no revela la respuesta). */
  hint?: string;
  /** Explicación completa; solo se muestra en nivel 4 o al final. */
  explanation?: string;
  references: { claimId: string; chunkId: string; page: number | null; text: string }[];
  nextRecommendation?: string;
  confusedWithConceptIds: string[];
  /** Detalle determinista (p. ej. pasos mal ubicados). */
  details?: Record<string, unknown>;
}

export interface DimensionValue {
  value: number | null;
  n: number;
}

export interface MasteryDimensions {
  freeRecall: DimensionValue;
  accuracy: DimensionValue;
  completeness: DimensionValue;
  discrimination: DimensionValue;
  application: DimensionValue;
  recognition: DimensionValue;
  hintIndependence: DimensionValue;
  delayedRetention: DimensionValue;
  errorCorrection: DimensionValue;
}

export interface UserSettings {
  /** Intervalos iniciales (días) tras la primera revisión según la calificación. */
  initialIntervalsDays: { again: number; hard: number; good: number; easy: number };
  desiredRetention: number;
  /** Nivel máximo de ayuda permitido (1–4). */
  maxHintLevel: number;
  retriesBeforeExplanation: number;
  dailyNewConcepts: number;
  dailyReviewGoal: number;
  weeklyMinutesGoal: number;
  /** Calibración personal: compara recuerdo predicho vs observado. */
  calibration: { n: number; predicted: number; observed: number };
}

export const DEFAULT_SETTINGS: UserSettings = {
  initialIntervalsDays: { again: 0.01, hard: 1, good: 3, easy: 6 },
  desiredRetention: 0.9,
  maxHintLevel: 4,
  retriesBeforeExplanation: 2,
  dailyNewConcepts: 8,
  dailyReviewGoal: 20,
  weeklyMinutesGoal: 150,
  calibration: { n: 0, predicted: 0, observed: 0 },
};

export function resolveSettings(s: Partial<UserSettings> | null | undefined): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    initialIntervalsDays: { ...DEFAULT_SETTINGS.initialIntervalsDays, ...(s?.initialIntervalsDays ?? {}) },
    calibration: { ...DEFAULT_SETTINGS.calibration, ...(s?.calibration ?? {}) },
  };
}

export const ACTIVITY_LABELS: Record<string, string> = {
  FREE_RECALL: "Recuperación libre",
  EXPLAIN: "Explícalo con tus palabras",
  PROCESS_ORDER: "Reconstrucción de proceso",
  CLOZE: "Completa lo que falta",
  RELATION: "Relaciones entre conceptos",
  PREDICTION: "Predicción y razonamiento",
  CASE: "Caso nuevo",
  RECOGNITION: "Reconocimiento (complementario)",
};
