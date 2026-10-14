import { and, eq, inArray } from "drizzle-orm";
import { withUser } from "@/db/client";
import { documents } from "@/db/schema";
import { geminiConfigured, searchGemini } from "./gemini";
import { matchLocalChunk, searchLocal } from "./local";
import type { Passage } from "./types";

export type { Passage };

/**
 * Recupera fragmentos relevantes de los libros indicados (o de todos los del usuario).
 * Estrategia: Gemini File Search para los libros indexados (semántica) + búsqueda local de
 * texto completo para el resto o como respaldo. Los resultados de Gemini se enlazan con el
 * fragmento local cuando es posible para mostrar la página exacta.
 */
export async function retrievePassages(userId: string, query: string, opts: { documentIds?: string[]; limit?: number } = {}): Promise<{ passages: Passage[]; provider: string }> {
  const limit = opts.limit ?? 8;
  const docs = await withUser(userId, (tx) =>
    tx
      .select({ id: documents.id, title: documents.title, indexStatus: documents.indexStatus })
      .from(documents)
      .where(and(eq(documents.userId, userId), opts.documentIds?.length ? inArray(documents.id, opts.documentIds) : undefined)),
  );
  if (!docs.length) return { passages: [], provider: "none" };
  const indexed = geminiConfigured() ? docs.filter((d) => d.indexStatus === "INDEXED") : [];
  const passages: Passage[] = [];
  let provider = "local";
  if (indexed.length) {
    try {
      const g = await searchGemini(userId, query, indexed, limit);
      for (const p of g) {
        const m = await matchLocalChunk(userId, p.documentId, p.text);
        passages.push(m ? { ...p, chunkId: m.chunkId, page: p.page ?? m.page } : p);
      }
      provider = "gemini_file_search";
    } catch (e) {
      console.warn("[retrieval] Gemini File Search no disponible, se usa la búsqueda local:", e instanceof Error ? e.message : e);
    }
  }
  const localIds = provider === "gemini_file_search" ? docs.filter((d) => d.indexStatus !== "INDEXED").map((d) => d.id) : docs.map((d) => d.id);
  if (localIds.length || passages.length < 3) {
    const local = await searchLocal(userId, query, provider === "gemini_file_search" && passages.length >= 3 ? localIds : docs.map((d) => d.id), limit);
    for (const l of local) if (!passages.some((p) => p.chunkId && p.chunkId === l.chunkId)) passages.push(l);
    if (provider === "gemini_file_search" && local.length) provider = "gemini_file_search+local";
  }
  return { passages: passages.slice(0, limit + 4), provider };
}
