import { describe, expect, it } from "vitest";
import { categorizeClaim, normalizeUrl, quoteInText } from "@/server/verification/categorize";
import { parsePubmedXml } from "@/server/verification/pubmed";

describe("categorización de afirmaciones", () => {
  it("solo se verifica automáticamente con al menos una fuente comprobada", () => {
    expect(categorizeClaim({ verdict: "SUPPORTED", validSources: 1, hasProposal: false })).toMatchObject({ category: "VERIFIED", autoValidated: true });
    const noSrc = categorizeClaim({ verdict: "SUPPORTED", validSources: 0, hasProposal: false });
    expect(noSrc).toMatchObject({ category: "NEEDS_REVIEW", verdict: "UNVERIFIABLE", autoValidated: false });
  });
  it("un 'error confirmado' sin fuente se rebaja a posible error", () => {
    expect(categorizeClaim({ verdict: "CONFIRMED_ERROR", validSources: 0, hasProposal: true })).toMatchObject({ verdict: "POSSIBLE_ERROR", category: "CORRECTION" });
    expect(categorizeClaim({ verdict: "CONFIRMED_ERROR", validSources: 2, hasProposal: true })).toMatchObject({ verdict: "CONFIRMED_ERROR", category: "CORRECTION" });
  });
  it("lo no verificable o discrepante queda para revisión y nunca se valida solo", () => {
    for (const v of ["UNVERIFIABLE", "SOURCE_DISAGREEMENT", "INTERNAL_CONTRADICTION"] as const)
      expect(categorizeClaim({ verdict: v, validSources: 3, hasProposal: false })).toMatchObject({ category: "NEEDS_REVIEW", autoValidated: false });
  });
  it("normaliza URLs para comparar con los resultados reales de búsqueda", () => {
    expect(normalizeUrl("https://www.Example.org/a/b/?utm_source=x#frag")).toBe("https://example.org/a/b");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("comprueba que la cita literal existe en el fragmento", () => {
    expect(quoteInText("el calcio se une a la troponina", "En reposo, el  Calcio se une a la troponina C.")).toBe(true);
    expect(quoteInText("el calcio se une a la tropomiosina", "el calcio se une a la troponina C")).toBe(false);
  });
  it("lee artículos reales del XML de PubMed", () => {
    const xml = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">12345</PMID><Article><Journal><Title>J Physiol</Title><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue></Journal><ArticleTitle>Calcium &amp; troponin</ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Calcium binds troponin C and this is long enough text for the abstract filter to keep it.</AbstractText></Abstract></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1/x</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
    const [a] = parsePubmedXml(xml);
    expect(a).toMatchObject({ pmid: "12345", title: "Calcium & troponin", journal: "J Physiol", year: "2020", doi: "10.1/x", url: "https://pubmed.ncbi.nlm.nih.gov/12345/" });
  });
});
