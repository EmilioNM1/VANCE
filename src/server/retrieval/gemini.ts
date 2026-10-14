/**
 * Recuperación con Google Gemini API · File Search.
 * - Un almacén (FileSearchStore) por usuario: los libros de un usuario nunca se mezclan con los de otro.
 * - Cada documento se sube con metadatos (document_id) para filtrar por libro.
 * - Las consultas usan la herramienta fileSearch de generateContent y se leen los fragmentos
 *   recuperados (groundingMetadata.groundingChunks[].retrievedContext): texto, título y página.
 * Requiere GEMINI_API_KEY. Sin ella, la plataforma usa la búsqueda local (local.ts).
 */
import { GoogleGenAI } from "@google/genai";
import { eq } from "drizzle-orm";
import { withUser } from "@/db/client";
import { retrievalStores } from "@/db/schema";
import { assertBudget, recordUsage } from "../ai";
import type { Passage } from "./types";

let client: GoogleGenAI | null | undefined;
export function geminiConfigured() {
  return !!process.env.GEMINI_API_KEY && process.env.RETRIEVAL_PROVIDER !== "local";
}
function ai(): GoogleGenAI {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY no configurada");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}
const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

/** Tipos admitidos por File Search que la plataforma acepta como libros. */
const INDEXABLE = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
export const isIndexable = (mime: string) => INDEXABLE.has(mime);

export async function ensureStore(userId: string): Promise<string> {
  const [row] = await withUser(userId, (tx) => tx.select().from(retrievalStores).where(eq(retrievalStores.userId, userId)));
  if (row) return row.storeName;
  const store = await ai().fileSearchStores.create({ config: { displayName: `vance-${userId}` } });
  if (!store.name) throw new Error("Gemini no devolvió el nombre del almacén");
  await withUser(userId, (tx) => tx.insert(retrievalStores).values({ userId, provider: "GEMINI_FILE_SEARCH", storeName: store.name! }).onConflictDoNothing());
  return store.name;
}

export async function indexFile(userId: string, doc: { id: string; title: string; mimeType: string }, data: Buffer): Promise<string> {
  const storeName = await ensureStore(userId);
  let op = await ai().fileSearchStores.uploadToFileSearchStore({
    file: new Blob([new Uint8Array(data)], { type: doc.mimeType }),
    fileSearchStoreName: storeName,
    config: {
      displayName: doc.title.slice(0, 200),
      mimeType: doc.mimeType,
      customMetadata: [{ key: "document_id", stringValue: doc.id }],
    },
  });
  const deadline = Date.now() + 10 * 60_000;
  while (!op.done) {
    if (Date.now() > deadline) throw new Error("La indexación tardó demasiado");
    await new Promise((r) => setTimeout(r, 4000));
    op = await ai().operations.get({ operation: op });
  }
  if (op.error) throw new Error(`Gemini no pudo indexar el documento: ${JSON.stringify(op.error).slice(0, 300)}`);
  const name = (op.response as { documentName?: string } | undefined)?.documentName;
  return name ?? `${storeName}#${doc.id}`;
}

export async function removeIndexedDocument(indexRef: string) {
  if (!indexRef || indexRef.includes("#")) return;
  await ai().fileSearchStores.documents.delete({ name: indexRef, config: { force: true } });
}

export async function searchGemini(userId: string, query: string, documents: { id: string; title: string }[], limit = 8): Promise<Passage[]> {
  await assertBudget(userId);
  const storeName = await ensureStore(userId);
  const filter = documents.map((d) => `document_id="${d.id.replace(/[^0-9a-f-]/gi, "")}"`).join(" OR ");
  const res = await ai().models.generateContent({
    model: MODEL(),
    contents: `Recupera de los documentos los pasajes que mejor respondan o contrasten esta consulta de un estudiante. Consulta: «${query.slice(0, 2000)}». Responde en una frase.`,
    config: { tools: [{ fileSearch: { fileSearchStoreNames: [storeName], metadataFilter: filter || undefined, topK: limit } }] },
  });
  const u = res.usageMetadata;
  await recordUsage(userId, "retrieval.gemini_file_search", MODEL(), u?.promptTokenCount ?? 0, (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0));
  const titleById = new Map(documents.map((d) => [d.id, d.title]));
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const out: Passage[] = [];
  for (const [i, c] of chunks.entries()) {
    const rc = c.retrievedContext;
    if (!rc?.text) continue;
    const docId = rc.customMetadata?.find((m) => m.key === "document_id")?.stringValue;
    // Solo se aceptan fragmentos atribuibles a un libro del usuario
    if (!docId || !titleById.has(docId)) continue;
    out.push({
      documentId: docId,
      documentTitle: titleById.get(docId)!,
      chunkId: null,
      page: typeof rc.pageNumber === "number" ? rc.pageNumber : null,
      text: rc.text,
      score: 1 - i / Math.max(1, chunks.length),
      provider: "GEMINI_FILE_SEARCH",
    });
  }
  return out;
}
