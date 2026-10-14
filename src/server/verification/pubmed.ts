/**
 * Cliente mínimo de NCBI E-utilities (PubMed). Devuelve solo artículos reales con su PMID;
 * estos son los únicos identificadores que el sistema permite citar como fuente PubMed.
 */
export interface PubmedArticle {
  pmid: string;
  title: string;
  journal: string | null;
  year: string | null;
  doi: string | null;
  abstract: string;
  url: string;
}

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
let lastCall = 0;

async function throttled(url: string): Promise<Response> {
  const minGap = process.env.NCBI_API_KEY ? 110 : 350;
  const wait = lastCall + minGap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`PubMed respondió ${res.status}`);
  return res;
}

function params(extra: Record<string, string>) {
  const p = new URLSearchParams({ db: "pubmed", tool: "vance", ...extra });
  if (process.env.NCBI_API_KEY) p.set("api_key", process.env.NCBI_API_KEY);
  if (process.env.NCBI_CONTACT_EMAIL) p.set("email", process.env.NCBI_CONTACT_EMAIL);
  return p.toString();
}

function decode(s: string) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePubmedXml(xml: string): PubmedArticle[] {
  const out: PubmedArticle[] = [];
  for (const art of xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? []) {
    const pmid = art.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    const title = art.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1];
    if (!pmid || !title) continue;
    const abstract = [...art.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => {
        const label = m[1]!.match(/Label="([^"]+)"/)?.[1];
        return (label ? `${label}: ` : "") + decode(m[2]!);
      })
      .join(" ");
    out.push({
      pmid,
      title: decode(title),
      journal: decode(art.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] ?? "") || null,
      year: art.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ?? art.match(/<MedlineDate>(\d{4})/)?.[1] ?? null,
      doi: art.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1] ?? null,
      abstract,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    });
  }
  return out;
}

export async function searchPubmed(query: string, max = 3): Promise<PubmedArticle[]> {
  const term = `${query} AND (review[pt] OR systematic[sb] OR english[la])`;
  const s = await throttled(`${BASE}/esearch.fcgi?${params({ term, retmax: String(max), retmode: "json", sort: "relevance" })}`);
  const ids: string[] = ((await s.json()) as { esearchresult?: { idlist?: string[] } }).esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const f = await throttled(`${BASE}/efetch.fcgi?${params({ id: ids.join(","), retmode: "xml" })}`);
  return parsePubmedXml(await f.text()).filter((a) => a.abstract.length > 50);
}
