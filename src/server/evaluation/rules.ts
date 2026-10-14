import type { AnswerKey, EvaluationResult, Rubric } from "@/lib/types";

/** Normaliza para comparar: minúsculas, sin tildes ni signos, espacios simples. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}+\-^/=]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n]!;
}

/** Acepta errores tipográficos menores salvo en cifras/fórmulas (precisión exacta). */
export function termMatches(given: string, expected: string): "EXACT" | "TYPO" | "NO" {
  const g = normalize(given);
  const e = normalize(expected);
  if (!g) return "NO";
  if (g === e) return "EXACT";
  if (/\d/.test(e)) return "NO";
  const tol = e.length >= 10 ? 2 : e.length >= 5 ? 1 : 0;
  return tol && levenshtein(g, e) <= tol ? "TYPO" : "NO";
}

const baseResult = (): Omit<EvaluationResult, "score" | "verdict" | "feedback"> => ({
  elements: [],
  correct: [],
  incorrect: [],
  missing: [],
  criticalErrors: [],
  references: [],
  confusedWithConceptIds: [],
});

export const verdictFor = (score: number): EvaluationResult["verdict"] => (score >= 0.85 ? "CORRECT" : score >= 0.4 ? "PARTIAL" : "INCORRECT");

/** Orden de pasos: combina pares bien ordenados y posiciones exactas. */
export function evaluateOrder(given: string[], key: AnswerKey, rubric: Rubric, itemText: Map<string, string>): EvaluationResult {
  const correct = key.order ?? [];
  const n = correct.length;
  const pos = new Map(correct.map((id, i) => [id, i]));
  const valid = given.length === n && new Set(given).size === n && given.every((g) => pos.has(g));
  if (!valid) {
    return { ...baseResult(), score: 0, verdict: "INCORRECT", feedback: "La respuesta no contiene todos los pasos exactamente una vez." };
  }
  let pairsOk = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      pairs++;
      if (pos.get(given[i]!)! < pos.get(given[j]!)!) pairsOk++;
    }
  const exact = given.filter((g, i) => pos.get(g) === i).length;
  const score = Math.round((0.5 * (pairsOk / pairs) + 0.5 * (exact / n)) * 100) / 100;
  // Pasos fuera de la subsecuencia creciente más larga = mal ubicados
  const seq = given.map((g) => pos.get(g)!);
  const lisIdx = longestIncreasingSubsequence(seq);
  const misplaced = given.filter((_, i) => !lisIdx.has(i));
  const elements = given.map((g, i) => ({
    id: g,
    label: `Posición ${i + 1}`,
    status: (pos.get(g) === i ? "PRESENT" : misplaced.includes(g) ? "INCORRECT" : "PARTIAL") as "PRESENT" | "INCORRECT" | "PARTIAL",
  }));
  return {
    ...baseResult(),
    score,
    verdict: score === 1 ? "CORRECT" : verdictFor(score),
    elements,
    correct: given.filter((g, i) => pos.get(g) === i).map((g) => itemText.get(g) ?? g),
    incorrect: misplaced.map((g) => ({ description: `«${itemText.get(g) ?? g}» no está en su lugar` })),
    feedback:
      score === 1
        ? "Orden correcto."
        : `${exact} de ${n} pasos están en su posición exacta y ${pairsOk} de ${pairs} pares de pasos están en el orden relativo correcto.`,
    details: { misplaced, exact, n, pairsOk, pairs },
    explanation: rubric.explanation,
  };
}

function longestIncreasingSubsequence(seq: number[]): Set<number> {
  const n = seq.length;
  const len = Array(n).fill(1);
  const prev = Array(n).fill(-1);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      if (seq[j]! < seq[i]! && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
  let best = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[best]) best = i;
  const out = new Set<number>();
  for (let i = best; i >= 0; i = prev[i]) out.add(i);
  return out;
}

export function evaluateCloze(given: Record<string, string>, key: AnswerKey, rubric: Rubric): EvaluationResult {
  const blanks = key.blanks ?? {};
  const ids = Object.keys(blanks);
  const elements: EvaluationResult["elements"] = [];
  let pts = 0;
  const typos: string[] = [];
  for (const [i, id] of ids.entries()) {
    const exp = blanks[id]!;
    const g = (given[id] ?? "").slice(0, 200);
    const matches = [exp.answer, ...exp.accept].map((a) => termMatches(g, a));
    const m = matches.includes("EXACT") ? "EXACT" : matches.includes("TYPO") ? "TYPO" : "NO";
    if (m === "EXACT") pts += 1;
    if (m === "TYPO") {
      pts += 0.9;
      typos.push(`Hueco ${i + 1}: correcto con una pequeña errata ("${g}").`);
    }
    elements.push({ id, label: `Hueco ${i + 1}`, status: m === "NO" ? (g.trim() ? "INCORRECT" : "ABSENT") : "PRESENT" });
  }
  const score = ids.length ? Math.round((pts / ids.length) * 100) / 100 : 0;
  return {
    ...baseResult(),
    score,
    verdict: verdictFor(score),
    elements,
    correct: elements.filter((e) => e.status === "PRESENT").map((e) => e.label),
    incorrect: elements.filter((e) => e.status === "INCORRECT").map((e) => ({ description: `${e.label}: el término no es correcto` })),
    missing: elements.filter((e) => e.status === "ABSENT").map((e) => e.label),
    feedback: [`${elements.filter((e) => e.status === "PRESENT").length} de ${ids.length} huecos correctos.`, ...typos].join(" "),
    explanation: rubric.explanation,
  };
}

export function evaluateRecognition(optionId: string, key: AnswerKey, rubric: Rubric): EvaluationResult {
  const ok = optionId === key.correctOptionId;
  const chosenConcept = key.optionConceptIds?.[optionId];
  const correctConcept = key.optionConceptIds?.[key.correctOptionId ?? ""];
  return {
    ...baseResult(),
    score: ok ? 1 : 0,
    verdict: ok ? "CORRECT" : "INCORRECT",
    elements: [{ id: "e1", label: "Identificación del concepto", status: ok ? "PRESENT" : "INCORRECT" }],
    correct: ok ? ["Has reconocido el concepto"] : [],
    incorrect: ok ? [] : [{ description: "La opción elegida corresponde a otro concepto" }],
    confusedWithConceptIds: !ok && chosenConcept && chosenConcept !== correctConcept ? [chosenConcept] : [],
    feedback: ok
      ? "Lo has reconocido. Reconocer no es lo mismo que recordar: a continuación tendrás que recuperarlo sin opciones."
      : "No es la opción correcta.",
    explanation: rubric.explanation,
  };
}

/** Completar un esquema: cada hueco debe recibir su etiqueta correcta (evaluación verificable). */
export function evaluateDiagram(given: Record<string, string>, key: AnswerKey, rubric: Rubric, labels: Map<string, string>): EvaluationResult {
  const slots = key.slots ?? {};
  const nodeIds = Object.keys(slots);
  const used = Object.values(given);
  const duplicated = new Set(used.filter((v, i) => used.indexOf(v) !== i));
  const elements = nodeIds.map((nodeId, i) => {
    const g = given[nodeId];
    const ok = !!g && g === slots[nodeId] && !duplicated.has(g);
    return { id: nodeId, label: `Hueco ${i + 1}`, status: (ok ? "PRESENT" : g ? "INCORRECT" : "ABSENT") as "PRESENT" | "INCORRECT" | "ABSENT" };
  });
  const okCount = elements.filter((e) => e.status === "PRESENT").length;
  const score = nodeIds.length ? Math.round((okCount / nodeIds.length) * 100) / 100 : 0;
  return {
    ...baseResult(),
    score,
    verdict: verdictFor(score),
    elements,
    correct: elements.filter((e) => e.status === "PRESENT").map((e) => e.label),
    incorrect: elements
      .filter((e) => e.status === "INCORRECT")
      .map((e) => ({ description: `${e.label}: «${labels.get(given[e.id]!) ?? "?"}» no va ahí` })),
    missing: elements.filter((e) => e.status === "ABSENT").map((e) => e.label),
    feedback: `${okCount} de ${nodeIds.length} huecos del esquema correctos.`,
    details: { wrongNodes: elements.filter((e) => e.status !== "PRESENT").map((e) => e.id) },
    explanation: rubric.explanation,
  };
}
