/**
 * Respuestas simuladas (SOLO PRUEBAS) para un texto de fisiología muscular.
 * Imitan el formato que devolvería la IA real para ejercitar toda la lógica de validación.
 */
import { FakeAi } from "./fake-ai";

export const MUSCLE_DOC = `# Fisiología muscular

## Acoplamiento excitación-contracción
La neurona motora libera acetilcolina en la unión neuromuscular. El potencial de acción se propaga por los túbulos T. El receptor DHPR activa al receptor RyR1, que libera calcio desde el retículo sarcoplásmico. El calcio se une a la troponina C, lo que desplaza la tropomiosina y expone los sitios de unión de la actina. La miosina se une a la actina y genera fuerza.

## Datos complementarios
El potencial de reposo de la fibra muscular esquelética es de aproximadamente -90 mV. La miosina es una proteína del filamento delgado.
`;

const sentences = (t: string) =>
  t
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

export function muscleAi() {
  return new FakeAi({
    "audit.extract_claims": (req) => {
      const text = (req.content[0] as { text: string }).text;
      const claims: unknown[] = [];
      for (const m of text.matchAll(/\[(F\d+)\][^\n]*\n([\s\S]*?)(?=\n\n\[F\d+\]|$)/g)) {
        for (const s of sentences(m[2]!))
          claims.push({ chunkRef: m[1], kind: s.includes("-90") ? "NUMBER" : "MECHANISM", text: s, quote: s, biomedical: true, searchQuery: "muscle", extractionIssue: null });
      }
      // Una afirmación con referencia a un fragmento inexistente (debe ignorarse)
      claims.push({ chunkRef: "F99", kind: "FACT", text: "Inventada", quote: "x", biomedical: false, searchQuery: "", extractionIssue: null });
      return { data: { claims } };
    },
    "audit.verify_claims": (req) => {
      const text = (req.content[0] as { text: string }).text;
      const results = [...text.matchAll(/\[(A\d+)\] \(\w+\) (.+)/g)].map(([, ref, claim]) => {
        if (claim!.includes("filamento delgado"))
          return {
            claimRef: ref,
            verdict: "CONFIRMED_ERROR",
            rationale: "La miosina forma el filamento grueso.",
            proposedText: "La miosina es una proteína del filamento grueso.",
            sources: [{ evidenceId: null, url: "https://example.edu/miosina", stance: "CONTRADICTS", excerpt: "Myosin forms the thick filament." }],
          };
        if (claim!.includes("-90"))
          return { claimRef: ref, verdict: "UNVERIFIABLE", rationale: "No se encontró una fuente concluyente.", proposedText: null, sources: [] };
        return {
          claimRef: ref,
          verdict: "SUPPORTED",
          rationale: "Coincide con la bibliografía.",
          proposedText: null,
          sources: [
            { evidenceId: null, url: "https://physio.example.org/ecc", stance: "SUPPORTS", excerpt: "ECC review" },
            { evidenceId: "E7", url: null, stance: "SUPPORTS", excerpt: "inventada" },
            { evidenceId: null, url: "https://fake.example/invented-doi", stance: "SUPPORTS", excerpt: "inventada" },
          ],
        };
      });
      return {
        data: { results },
        webResults: [
          { url: "https://www.physio.example.org/ecc/", title: "Excitation-contraction coupling (review)" },
          { url: "https://example.edu/miosina", title: "Thick filament structure" },
        ],
      };
    },
    "audit.contradictions": () => ({ data: { pairs: [] } }),
    "knowledge.build": (req) => {
      const text = (req.content[0] as { text: string }).text;
      const refs = [...text.matchAll(/\[(C\d+)\] (.+)/g)].map(([, ref, t]) => ({ ref: ref!, t: t! }));
      const find = (w: string) => refs.filter((r) => r.t.includes(w)).map((r) => r.ref);
      const stepWords = ["acetilcolina", "túbulos T", "RyR1", "troponina C", "miosina se une"];
      const concepts = [];
      if (find("acetilcolina").length)
        concepts.push({
          key: "K1",
          name: "Acoplamiento excitación-contracción",
          kind: "MECHANISM",
          summary: "Secuencia que convierte el potencial de acción en contracción.",
          importance: 3,
          claimRefs: find("acetilcolina"),
          keyTerms: ["calcio", "troponina"],
          steps: stepWords.map((w) => ({ text: refs.find((r) => r.t.includes(w))?.t ?? w, claimRefs: find(w) })),
          formula: null,
          components: [],
          examples: [],
          exceptions: [],
          misconceptions: ["Creer que el calcio se une a la tropomiosina"],
          applications: [],
        });
      if (find("troponina").length)
        concepts.push({ key: "K2", name: "Troponina", kind: "CONCEPT", summary: "La troponina C fija calcio y desplaza la tropomiosina.", importance: 2, claimRefs: find("troponina"), keyTerms: ["calcio"], steps: [], formula: null, components: [], examples: [], exceptions: [], misconceptions: [], applications: [] });
      if (find("filamento grueso").length)
        concepts.push({ key: "K3", name: "Miosina", kind: "CONCEPT", summary: "La miosina es una proteína del filamento grueso.", importance: 2, claimRefs: find("filamento grueso"), keyTerms: ["filamento grueso"], steps: [], formula: null, components: [], examples: [], exceptions: [], misconceptions: [], applications: [] });
      // Concepto inventado sin respaldo: debe descartarse
      concepts.push({ key: "K9", name: "Concepto sin fuente", kind: "FACT", summary: "x", importance: 1, claimRefs: ["C999"], keyTerms: [], steps: [], formula: null, components: [], examples: [], exceptions: [], misconceptions: [], applications: [] });
      return {
        data: {
          concepts,
          relations: find("troponina").length && find("acetilcolina").length ? [{ from: "K2", to: "K1", type: "PART_OF", description: "La troponina participa en el acoplamiento.", claimRefs: find("troponina") }] : [],
        },
      };
    },
    "knowledge.global_relations": () => ({ data: { relations: [] } }),
    "activities.generate": (req) => {
      const text = (req.content[0] as { text: string }).text;
      const out: unknown[] = [];
      for (const block of text.split(/\n\n(?=\[K\d+\])/)) {
        const head = block.match(/^\[(K\d+)\] .+ — genera: (.+)$/m);
        if (!head) continue;
        const firstRef = block.match(/\[(C\d+)\]/)?.[1] ?? "C0";
        for (const type of head[2]!.split(", ")) {
          out.push({
            conceptKey: head[1],
            type,
            prompt: `Explica de memoria (${type})`,
            scenario: type === "CASE" ? "Un paciente recibe un fármaco que bloquea RyR1." : null,
            relatedConceptKeys: [],
            referenceAnswer: "El calcio se une a la troponina C, desplaza la tropomiosina y expone la actina.",
            essentialElements: [
              { description: "Ion desencadenante", keyTerms: ["calcio"], weight: 2, claimRefs: [firstRef] },
              { description: "Proteína reguladora", keyTerms: ["troponina"], weight: 1, claimRefs: [firstRef] },
              { description: "Sin respaldo", keyTerms: ["x"], weight: 1, claimRefs: ["C404"] },
            ],
            relationElements: [{ description: "Consecuencia sobre la actina", keyTerms: ["actina"], weight: 2, claimRefs: [firstRef] }],
            criticalErrors: [{ description: "Afirma que el calcio se une a la tropomiosina", tag: "calcio-tropomiosina" }],
            optionalElements: [],
            precision: "CONCEPTUAL",
            hints: ["Piensa en el ion.", "¿Qué proteína lo fija?", "¿Qué ocurre con la tropomiosina?"],
            explanation: "Explicación completa del mecanismo.",
            claimRefs: [firstRef],
          });
        }
      }
      // Actividad sin ninguna fuente válida: debe rechazarse
      out.push({ ...(out[0] as object), claimRefs: ["C500"], essentialElements: [{ description: "x", keyTerms: [], weight: 1, claimRefs: ["C501"] }], relationElements: [] });
      return { data: { activities: out } };
    },
    "evaluation.semantic": (req) => {
      const text = (req.content[0] as { text: string }).text;
      const answer = text.split('"""')[1] ?? "";
      const a = answer.toLowerCase();
      const ids = [...text.matchAll(/- \[([er]\d+)\]/g)].map((m) => m[1]!);
      const wrong = a.includes("calcio se une a la tropomiosina");
      const full = a.includes("calcio") && a.includes("troponina") && a.includes("actina") && !wrong;
      const elements = ids.map((id, i) => ({ id, status: full ? "PRESENT" : i === 0 && a.includes("calcio") ? "PRESENT" : "ABSENT", evidence: "", note: "" }));
      return {
        data: {
          elements,
          criticalErrors: wrong ? [{ rubricId: "x1", tag: "calcio-tropomiosina", description: "Confunde troponina con tropomiosina" }] : [],
          incorrectStatements: wrong ? [{ statement: "El calcio se une a la tropomiosina", explanation: "Se une a la troponina C" }] : [],
          ambiguous: false,
          ambiguityNote: "",
          confusedWithConcepts: wrong ? ["Troponina"] : [],
          feedback: full ? "Muy bien." : "Has recordado una parte.",
          nextHint: "Pista adaptada: revisa qué proteína fija el ion.",
          explanation: "Corrección adaptada a tu respuesta.",
          nextRecommendation: "Repite la explicación mañana.",
        },
      };
    },
  });
}
