import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/db/client";
import { chunks, claims, concepts, documents, libraries, sections, type DocumentStatus } from "@/db/schema";
import { sha256 } from "../auth/password";
import { enqueueJob } from "../jobs/queue";
import { deleteStoredFile, saveFile } from "./storage";
import { validateUpload } from "./file-validation";

export class NotFoundError extends Error {
  constructor(what = "Recurso") {
    super(`${what} no encontrado`);
  }
}

export class ConflictError extends Error {}

// ───────────────────────────── Bibliotecas ─────────────────────────────

export const librarySchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120),
  subject: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
});

export async function createLibrary(userId: string, input: unknown) {
  const data = librarySchema.parse(input);
  return withUser(userId, async (tx) => {
    const [row] = await tx.insert(libraries).values({ ...data, userId }).returning();
    return row!;
  });
}

export async function listLibraries(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: libraries.id,
        name: libraries.name,
        subject: libraries.subject,
        description: libraries.description,
        isDemo: libraries.isDemo,
        createdAt: libraries.createdAt,
        documentCount: sql<number>`(select count(*)::int from documents d where d.library_id = ${libraries.id})`,
      })
      .from(libraries)
      .where(eq(libraries.userId, userId))
      .orderBy(desc(libraries.createdAt)),
  );
}

export async function getLibrary(userId: string, libraryId: string) {
  return withUser(userId, async (tx) => {
    const [lib] = await tx.select().from(libraries).where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)));
    if (!lib) throw new NotFoundError("Biblioteca");
    const docs = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.libraryId, libraryId), eq(documents.userId, userId)))
      .orderBy(desc(documents.createdAt));
    return { library: lib, documents: docs };
  });
}

export async function updateLibrary(userId: string, libraryId: string, input: unknown) {
  const data = librarySchema.partial().parse(input);
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .update(libraries)
      .set(data)
      .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
      .returning();
    if (!row) throw new NotFoundError("Biblioteca");
    return row;
  });
}

export async function deleteLibrary(userId: string, libraryId: string) {
  const keys = await withUser(userId, async (tx) => {
    const docs = await tx
      .select({ key: documents.storageKey })
      .from(documents)
      .where(and(eq(documents.libraryId, libraryId), eq(documents.userId, userId)));
    const res = await tx.delete(libraries).where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId))).returning();
    if (!res.length) throw new NotFoundError("Biblioteca");
    return docs.map((d) => d.key);
  });
  await Promise.all(keys.filter((k) => !k.startsWith("demo/")).map((k) => deleteStoredFile(k).catch(() => {})));
}

// ───────────────────────────── Documentos ─────────────────────────────

export const uploadMetaSchema = z.object({
  libraryId: z.string().uuid(),
  title: z.string().trim().max(200).optional(),
  topic: z.string().trim().max(200).optional(),
  rightsConfirmed: z.literal(true, { message: "Debes confirmar que tienes derecho a usar este material para tu estudio." }),
});

export async function createDocumentFromUpload(
  userId: string,
  meta: z.infer<typeof uploadMetaSchema>,
  file: { name: string; data: Buffer },
) {
  const valid = await validateUpload(file.name, file.data);
  const hash = sha256(file.data);
  await withUser(userId, async (tx) => {
    const [lib] = await tx.select({ id: libraries.id }).from(libraries).where(and(eq(libraries.id, meta.libraryId), eq(libraries.userId, userId)));
    if (!lib) throw new NotFoundError("Biblioteca");
    const [dup] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.libraryId, meta.libraryId), eq(documents.sha256, hash)));
    if (dup) throw new ConflictError("Este archivo ya está en la biblioteca.");
  });
  const storageKey = await saveFile(userId, file.data);
  const created = await withUser(userId, async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        userId,
        libraryId: meta.libraryId,
        title: meta.title?.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 200),
        topic: meta.topic || null,
        originalFilename: file.name.slice(0, 255),
        mimeType: valid.mimeType,
        sizeBytes: file.data.length,
        sha256: hash,
        storageKey,
        status: "UPLOADED",
        statusDetail: "En cola para extraer el texto",
        rightsConfirmedAt: new Date(),
      })
      .returning();
    return row!;
  });
  await enqueueJob("document.extract", { documentId: created.id }, userId);
  return created;
}

export async function listDocuments(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        libraryId: documents.libraryId,
        libraryName: libraries.name,
        isDemo: documents.isDemo,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .innerJoin(libraries, eq(libraries.id, documents.libraryId))
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.createdAt)),
  );
}

export async function getDocument(userId: string, documentId: string) {
  return withUser(userId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    if (!doc) throw new NotFoundError("Documento");
    return doc;
  });
}

export async function getDocumentOverview(userId: string, documentId: string) {
  return withUser(userId, async (tx) => {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    if (!doc) throw new NotFoundError("Documento");
    const [lib] = await tx.select().from(libraries).where(eq(libraries.id, doc.libraryId));
    const secs = await tx.select().from(sections).where(eq(sections.documentId, documentId)).orderBy(asc(sections.ord));
    const chs = await tx.select().from(chunks).where(eq(chunks.documentId, documentId)).orderBy(asc(chunks.ord));
    const claimStats = await tx
      .select({ category: claims.category, validated: claims.validated, decision: claims.decision, n: sql<number>`count(*)::int` })
      .from(claims)
      .where(eq(claims.documentId, documentId))
      .groupBy(claims.category, claims.validated, claims.decision);
    const [{ conceptCount } = { conceptCount: 0 }] = await tx
      .select({ conceptCount: sql<number>`count(*)::int` })
      .from(concepts)
      .where(eq(concepts.documentId, documentId));
    return { document: doc, library: lib!, sections: secs, chunks: chs, claimStats, conceptCount };
  });
}

export async function setDocumentStatus(userId: string, documentId: string, status: DocumentStatus, detail: string | null, extra: Partial<typeof documents.$inferInsert> = {}) {
  await withUser(userId, (tx) =>
    tx
      .update(documents)
      .set({ status, statusDetail: detail, updatedAt: new Date(), ...extra })
      .where(eq(documents.id, documentId)),
  );
}

/** Corrección manual de un error de extracción. El texto original se conserva. */
export async function editChunk(userId: string, chunkId: string, editedText: string | null) {
  const text = editedText === null ? null : z.string().trim().min(1).max(20000).parse(editedText);
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .update(chunks)
      .set({ editedText: text })
      .where(and(eq(chunks.id, chunkId), eq(chunks.userId, userId)))
      .returning();
    if (!row) throw new NotFoundError("Fragmento");
    return row;
  });
}

export async function updateDocumentMeta(userId: string, documentId: string, input: unknown) {
  const data = z.object({ title: z.string().trim().min(1).max(200).optional(), topic: z.string().trim().max(200).nullable().optional() }).parse(input);
  return withUser(userId, async (tx) => {
    const [row] = await tx.update(documents).set({ ...data, updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.userId, userId))).returning();
    if (!row) throw new NotFoundError("Documento");
    return row;
  });
}

/**
 * Reprocesa un documento desde una etapa. "extract" borra todo lo derivado (fragmentos,
 * afirmaciones, conceptos, actividades e historial asociado); "audit" conserva los fragmentos
 * (incluidas las correcciones manuales) y rehace la verificación.
 */
export async function reprocessDocument(userId: string, documentId: string, stage: "extract" | "audit" | "knowledge") {
  const doc = await getDocument(userId, documentId);
  if (doc.isDemo) throw new ConflictError("El documento de demostración no se puede reprocesar.");
  if (["EXTRACTING", "AUDITING", "BUILDING_KNOWLEDGE"].includes(doc.status))
    throw new ConflictError("El documento ya se está procesando.");
  await withUser(userId, async (tx) => {
    if (stage === "extract") {
      await tx.delete(sections).where(eq(sections.documentId, documentId));
      await tx.delete(chunks).where(eq(chunks.documentId, documentId));
    }
    if (stage === "extract" || stage === "audit") await tx.delete(claims).where(eq(claims.documentId, documentId));
    await tx.delete(concepts).where(eq(concepts.documentId, documentId));
    await tx
      .update(documents)
      .set({
        status: stage === "extract" ? "UPLOADED" : stage === "audit" ? "EXTRACTED" : "REVIEW",
        statusDetail: "En cola",
        error: null,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  });
  const type = stage === "extract" ? "document.extract" : stage === "audit" ? "document.audit" : "document.build_knowledge";
  await enqueueJob(type, { documentId }, userId);
}

export async function deleteDocument(userId: string, documentId: string) {
  const key = await withUser(userId, async (tx) => {
    const [row] = await tx.delete(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId))).returning();
    if (!row) throw new NotFoundError("Documento");
    return row.storageKey;
  });
  if (!key.startsWith("demo/")) await deleteStoredFile(key).catch(() => {});
}
