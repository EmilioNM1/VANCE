import type { ClaimCategory, ClaimVerdict } from "@/db/schema";

export interface CategorizeInput {
  verdict: ClaimVerdict;
  validSources: number;
  hasProposal: boolean;
}

export interface CategorizeOutput {
  verdict: ClaimVerdict;
  category: ClaimCategory;
  /** Solo se valida automáticamente lo respaldado por al menos una fuente real. */
  autoValidated: boolean;
  note?: string;
}

/**
 * Traduce el veredicto de la IA + las fuentes REALMENTE comprobadas a la categoría del informe.
 * Regla clave: sin fuente verificable no hay "verificado" ni "error confirmado".
 */
export function categorizeClaim({ verdict, validSources, hasProposal }: CategorizeInput): CategorizeOutput {
  switch (verdict) {
    case "SUPPORTED":
      if (validSources > 0) return { verdict, category: "VERIFIED", autoValidated: true };
      return {
        verdict: "UNVERIFIABLE",
        category: "NEEDS_REVIEW",
        autoValidated: false,
        note: "No se obtuvo ninguna fuente verificable que la respalde.",
      };
    case "CONFIRMED_ERROR":
      if (validSources > 0) return { verdict, category: hasProposal ? "CORRECTION" : "NEEDS_REVIEW", autoValidated: false };
      return {
        verdict: "POSSIBLE_ERROR",
        category: hasProposal ? "CORRECTION" : "NEEDS_REVIEW",
        autoValidated: false,
        note: "El posible error no está respaldado por una fuente verificable; se trata como propuesta.",
      };
    case "POSSIBLE_ERROR":
    case "OUTDATED":
    case "EXTRACTION_ERROR":
      return { verdict, category: hasProposal ? "CORRECTION" : "NEEDS_REVIEW", autoValidated: false };
    case "SOURCE_DISAGREEMENT":
    case "UNVERIFIABLE":
    case "INTERNAL_CONTRADICTION":
    case "PENDING":
      return { verdict, category: "NEEDS_REVIEW", autoValidated: false };
  }
}

export function normalizeUrl(u: string): string | null {
  try {
    const url = new URL(u.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) url.searchParams.delete(k);
    return `${url.protocol}//${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

/** Comprueba que la cita literal existe en el fragmento (tolerando espacios, mayúsculas y comillas). */
export function quoteInText(quote: string | null | undefined, text: string): boolean {
  if (!quote) return false;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[“”«»"']/g, "")
      .replace(/-\s+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const q = norm(quote);
  return q.length >= 8 && norm(text).includes(q);
}
