import { sql } from "drizzle-orm";
import { withUser } from "@/db/client";
import type { Passage } from "./types";

const STOP = new Set("el la los las un una unos unas de del al a en y o u que se por para con sin sobre entre como es son su sus lo le les este esta estos estas ese esa eso muy más mas pero si no ya cuando donde porque the of and to in is are".split(" "));

/** Palabras clave de una consulta libre (para combinarlas con OR en la búsqueda de texto). */
export function keywords(q: string, max = 12): string[] {
  const words = q
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, max);
}

/**
 * Búsqueda de texto completo en los fragmentos de los libros del usuario (PostgreSQL, español).
 * Devuelve la página exacta de cada fragmento. No usa IA ni consume tokens.
 */
export async function searchLocal(userId: string, query: string, documentIds: string[] | null, limit = 8): Promise<Passage[]> {
  const kw = keywords(query);
  if (!kw.length) return [];
  const tsq = kw.join(" OR ");
  return withUser(userId, async (tx) => {
    const docFilter = documentIds?.length ? sql`and c.document_id in (${sql.join(documentIds.map((d) => sql`${d}::uuid`), sql`, `)})` : sql``;
    const res = await tx.execute(sql`
      select c.id as chunk_id, c.document_id, d.title as document_title, c.page, coalesce(c.edited_text, c.text) as text,
             ts_rank_cd(c.search_tsv, websearch_to_tsquery('spanish', ${tsq})) as score
      from chunks c join documents d on d.id = c.document_id
      where c.user_id = ${userId} ${docFilter} and c.search_tsv @@ websearch_to_tsquery('spanish', ${tsq})
      order by score desc
      limit ${limit}`);
    return (res.rows as { chunk_id: string; document_id: string; document_title: string; page: number | null; text: string; score: number }[]).map((r) => ({
      documentId: r.document_id,
      documentTitle: r.document_title,
      chunkId: r.chunk_id,
      page: r.page,
      text: r.text,
      score: Number(r.score),
      provider: "LOCAL" as const,
    }));
  });
}

/** Busca el fragmento local que contiene un texto recuperado por un índice externo. */
export async function matchLocalChunk(userId: string, documentId: string, text: string): Promise<{ chunkId: string; page: number | null } | null> {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const t = norm(text);
  if (t.length < 30) return null;
  const probes = [t.slice(0, 80), t.slice(Math.floor(t.length / 2) - 40, Math.floor(t.length / 2) + 40), t.slice(-80)].filter((p) => p.length >= 30);
  return withUser(userId, async (tx) => {
    for (const p of probes) {
      const res = await tx.execute(sql`
        select id, page from chunks
        where user_id = ${userId} and document_id = ${documentId}
          and position(${p} in lower(regexp_replace(coalesce(edited_text, text), '\\s+', ' ', 'g'))) > 0
        limit 1`);
      const row = res.rows[0] as { id: string; page: number | null } | undefined;
      if (row) return { chunkId: row.id, page: row.page };
    }
    return null;
  });
}
