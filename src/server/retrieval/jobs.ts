import { eq } from "drizzle-orm";
import { withUser } from "@/db/client";
import { documents } from "@/db/schema";
import { PermanentJobError, type JobRow } from "../jobs/queue";
import { readStoredFile } from "../documents/storage";
import { geminiConfigured, indexFile, removeIndexedDocument } from "./gemini";

export async function handleIndexDocument(job: JobRow) {
  const { documentId } = job.payload as { documentId: string };
  const userId = job.userId!;
  if (!geminiConfigured()) return;
  const [doc] = await withUser(userId, (tx) => tx.select().from(documents).where(eq(documents.id, documentId)));
  if (!doc || doc.isDemo) return;
  await withUser(userId, (tx) => tx.update(documents).set({ indexProvider: "GEMINI_FILE_SEARCH", indexStatus: "INDEXING", indexError: null }).where(eq(documents.id, documentId)));
  try {
    const ref = await indexFile(userId, { id: doc.id, title: doc.title, mimeType: doc.mimeType }, await readStoredFile(doc.storageKey));
    await withUser(userId, (tx) => tx.update(documents).set({ indexStatus: "INDEXED", indexRef: ref }).where(eq(documents.id, documentId)));
  } catch (e) {
    const last = job.attempts >= job.maxAttempts;
    await withUser(userId, (tx) =>
      tx.update(documents).set({ indexStatus: last ? "FAILED" : "PENDING", indexError: e instanceof Error ? e.message.slice(0, 500) : String(e) }).where(eq(documents.id, documentId)),
    );
    if (last) throw new PermanentJobError(String(e));
    throw e;
  }
}

export async function handleUnindexDocument(job: JobRow) {
  const { indexRef } = job.payload as { indexRef: string };
  if (geminiConfigured() && indexRef) await removeIndexedDocument(indexRef);
}
