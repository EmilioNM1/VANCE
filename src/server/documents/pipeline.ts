import { eq } from "drizzle-orm";
import { withUser } from "@/db/client";
import { chunks, documents, sections } from "@/db/schema";
import { aiConfigured, aiStructured } from "../ai";
import { AiNotConfiguredError, AiUnavailableError } from "../ai/errors";
import { enqueueJob, PermanentJobError, type JobRow } from "../jobs/queue";
import { readStoredFile } from "./storage";
import { validateUpload } from "./file-validation";
import { extractDocument, ExtractionError, ocrSchema, structure, type OcrFn } from "./extract";
import { setDocumentStatus } from "./service";
import { geminiConfigured, isIndexable } from "../retrieval/gemini";

async function setDocumentIndex(userId: string, documentId: string) {
  await withUser(userId, (tx) => tx.update(documents).set({ indexProvider: "GEMINI_FILE_SEARCH", indexStatus: "PENDING" }).where(eq(documents.id, documentId)));
}

function ocrWithAi(userId: string): OcrFn {
  return async ({ kind, data, mimeType }) => {
    const res = await aiStructured({
      operation: "document.ocr",
      userId,
      effort: "low",
      maxTokens: 64000,
      system:
        "Eres un sistema de transcripción (OCR) fiel. Transcribe EXACTAMENTE el texto visible, en su idioma original, sin resumir, " +
        "sin corregir el contenido y sin añadir información. Conserva encabezados (kind=heading, level 1-3) y párrafos (kind=paragraph, level 0). " +
        "Las tablas transcríbelas como líneas con columnas separadas por ' | '. Las fórmulas en notación lineal legible. " +
        "Si hay figuras, diagramas o zonas que no puedes leer con seguridad, NO inventes su contenido: añade un bloque kind=figure_unreadable " +
        "con una breve descripción de qué es y por qué no se pudo interpretar.",
      content: [
        kind === "pdf"
          ? { type: "pdf", base64: data.toString("base64") }
          : { type: "image", base64: data.toString("base64"), mediaType: mimeType as "image/png" },
        { type: "text", text: "Transcribe el documento página por página (page empieza en 1)." },
      ],
      schema: ocrSchema,
    });
    return res.data.pages.map((p) => ({
      page: kind === "pdf" ? p.page : null,
      blocks: p.blocks.map((b) => ({ kind: b.kind, level: b.level || undefined, text: b.text })),
    }));
  };
}

export async function handleExtract(job: JobRow) {
  const { documentId } = job.payload as { documentId: string };
  const userId = job.userId!;
  const [doc] = await withUser(userId, (tx) => tx.select().from(documents).where(eq(documents.id, documentId)));
  if (!doc) return; // eliminado mientras estaba en cola
  await setDocumentStatus(userId, documentId, "EXTRACTING", "Leyendo el archivo y extrayendo el texto");
  try {
    const data = await readStoredFile(doc.storageKey);
    const valid = await validateUpload(doc.originalFilename, data);
    const extracted = await extractDocument(valid.kind, data, valid.mimeType, aiConfigured() ? ocrWithAi(userId) : null);
    const structured = structure(extracted, doc.title);
    if (!structured.length) throw new ExtractionError("No se encontró texto utilizable en el documento.", "EMPTY");

    await withUser(userId, async (tx) => {
      await tx.delete(sections).where(eq(sections.documentId, documentId));
      await tx.delete(chunks).where(eq(chunks.documentId, documentId));
      let ord = 0;
      for (let i = 0; i < structured.length; i++) {
        const s = structured[i]!;
        const [sec] = await tx
          .insert(sections)
          .values({ userId, documentId, ord: i, level: s.level, title: s.title.slice(0, 300), pageStart: s.pageStart, pageEnd: s.pageEnd })
          .returning({ id: sections.id });
        if (s.chunks.length)
          await tx.insert(chunks).values(
            s.chunks.map((c) => ({ userId, documentId, sectionId: sec!.id, ord: ord++, page: c.page, text: c.text, warnings: c.warnings })),
          );
      }
    });
    const ai = aiConfigured();
    await setDocumentStatus(
      userId,
      documentId,
      "EXTRACTED",
      ai ? "Texto extraído. En cola para la auditoría científica." : "Texto extraído. La auditoría requiere IA, que no está configurada.",
      {
        pageCount: extracted.pageCount,
        extractionMethod: extracted.method,
        warnings: extracted.warnings,
        error: null,
        errorCode: null,
      },
    );
    if (ai) await enqueueJob("document.audit", { documentId }, userId);
    // Índice semántico externo (opcional): independiente de la auditoría
    if (geminiConfigured() && isIndexable(valid.mimeType)) {
      await setDocumentIndex(userId, documentId);
      await enqueueJob("document.index", { documentId }, userId, { maxAttempts: 3 });
    }
  } catch (e) {
    const isLast = job.attempts >= job.maxAttempts;
    if (e instanceof ExtractionError) {
      await setDocumentStatus(userId, documentId, "FAILED", null, { error: e.message, errorCode: e.code });
      throw new PermanentJobError(e.message);
    }
    if (e instanceof AiNotConfiguredError || (e instanceof AiUnavailableError && (!e.retryable || isLast))) {
      await setDocumentStatus(userId, documentId, "FAILED", null, { error: e.message, errorCode: "AI_UNAVAILABLE" });
      throw new PermanentJobError(e.message);
    }
    await setDocumentStatus(
      userId,
      documentId,
      isLast ? "FAILED" : "UPLOADED",
      isLast ? null : "Error temporal; se reintentará automáticamente.",
      { error: isLast ? `El procesamiento falló: ${e instanceof Error ? e.message : String(e)}` : null, errorCode: isLast ? "PROCESSING_FAILED" : null },
    );
    throw e;
  }
}
