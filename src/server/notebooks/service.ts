import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withUser, type Tx } from "@/db/client";
import { documents, noteAssets, notebookPages, notebooks, notebookSections, pageConceptLinks, pageDocumentLinks, pageVersions, libraries } from "@/db/schema";
import { EMPTY_DOC, type NoteDoc } from "@/lib/types";
import { ConflictError, NotFoundError } from "../documents/service";
import { saveFile, readStoredFile } from "../documents/storage";
import { contentHash, docToText, sanitizeDoc, wordCount } from "./content";

export class VersionConflictError extends Error {
  constructor(public server: { version: number; title: string; content: NoteDoc; updatedAt: Date }) {
    super("La página se modificó en otro dispositivo.");
  }
}

const NOTEBOOK_COLORS = ["teal", "indigo", "rose", "amber", "emerald", "slate", "violet", "sky"] as const;
const titleSchema = z.string().trim().min(1, "El título no puede estar vacío").max(200);
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const MAX_VERSIONS = 50;

async function nextOrd(tx: Tx, table: typeof notebooks | typeof notebookSections | typeof notebookPages, where: ReturnType<typeof eq>) {
  const [r] = await tx.select({ m: sql<number>`coalesce(max(${table.ord}), -1)::int` }).from(table).where(where);
  return (r?.m ?? -1) + 1;
}

async function ownPage(tx: Tx, userId: string, pageId: string) {
  const [p] = await tx.select().from(notebookPages).where(and(eq(notebookPages.id, pageId), eq(notebookPages.userId, userId)));
  if (!p) throw new NotFoundError("Página");
  return p;
}
async function ownSection(tx: Tx, userId: string, sectionId: string) {
  const [s] = await tx.select().from(notebookSections).where(and(eq(notebookSections.id, sectionId), eq(notebookSections.userId, userId)));
  if (!s) throw new NotFoundError("Sección");
  return s;
}
async function ownNotebook(tx: Tx, userId: string, notebookId: string) {
  const [n] = await tx.select().from(notebooks).where(and(eq(notebooks.id, notebookId), eq(notebooks.userId, userId)));
  if (!n) throw new NotFoundError("Cuaderno");
  return n;
}

function derive(content: NoteDoc) {
  const text = docToText(content);
  return { contentText: text, contentHash: contentHash(text), wordCount: wordCount(text) };
}

// ───────────────────────────── Árbol ─────────────────────────────

export async function listNotebooks(userId: string) {
  return withUser(userId, async (tx) => {
    const nbs = await tx.select().from(notebooks).where(eq(notebooks.userId, userId)).orderBy(asc(notebooks.ord), asc(notebooks.createdAt));
    const counts = await tx
      .select({ notebookId: notebookPages.notebookId, n: sql<number>`count(*)::int`, last: sql<Date>`max(${notebookPages.updatedAt})` })
      .from(notebookPages)
      .where(eq(notebookPages.userId, userId))
      .groupBy(notebookPages.notebookId);
    const by = new Map(counts.map((c) => [c.notebookId, c]));
    return nbs.map((n) => ({ ...n, pageCount: by.get(n.id)?.n ?? 0, lastEdited: by.get(n.id)?.last ? new Date(by.get(n.id)!.last) : null }));
  });
}

export async function getNotebookTree(userId: string, notebookId: string) {
  return withUser(userId, async (tx) => {
    const nb = await ownNotebook(tx, userId, notebookId);
    const secs = await tx.select().from(notebookSections).where(eq(notebookSections.notebookId, notebookId)).orderBy(asc(notebookSections.ord), asc(notebookSections.createdAt));
    const pages = await tx
      .select({ id: notebookPages.id, sectionId: notebookPages.sectionId, title: notebookPages.title, ord: notebookPages.ord, updatedAt: notebookPages.updatedAt, wordCount: notebookPages.wordCount })
      .from(notebookPages)
      .where(eq(notebookPages.notebookId, notebookId))
      .orderBy(asc(notebookPages.ord), asc(notebookPages.createdAt));
    return { notebook: nb, sections: secs.map((s) => ({ ...s, pages: pages.filter((p) => p.sectionId === s.id) })) };
  });
}

// ───────────────────────────── Cuadernos ─────────────────────────────

export const notebookInput = z.object({
  title: titleSchema,
  subject: z.string().trim().max(120).nullable().optional(),
  color: z.enum(NOTEBOOK_COLORS).optional(),
});

/** Crea el cuaderno con una primera sección y una primera página listas para escribir. */
export async function createNotebook(userId: string, input: unknown) {
  const data = notebookInput.parse(input);
  return withUser(userId, async (tx) => {
    const [nb] = await tx
      .insert(notebooks)
      .values({ userId, title: data.title, subject: data.subject ?? null, color: data.color ?? "teal", ord: await nextOrd(tx, notebooks, eq(notebooks.userId, userId)) })
      .returning();
    const [sec] = await tx.insert(notebookSections).values({ userId, notebookId: nb!.id, title: "General", ord: 0 }).returning();
    const [page] = await tx
      .insert(notebookPages)
      .values({ userId, notebookId: nb!.id, sectionId: sec!.id, title: "Sin título", ord: 0, content: EMPTY_DOC, ...derive(EMPTY_DOC) })
      .returning({ id: notebookPages.id });
    return { notebook: nb!, sectionId: sec!.id, pageId: page!.id };
  });
}

export async function updateNotebook(userId: string, notebookId: string, input: unknown) {
  const data = notebookInput.partial().parse(input);
  return withUser(userId, async (tx) => {
    await ownNotebook(tx, userId, notebookId);
    const [r] = await tx.update(notebooks).set({ ...data, updatedAt: new Date() }).where(eq(notebooks.id, notebookId)).returning();
    return r!;
  });
}

export async function deleteNotebook(userId: string, notebookId: string) {
  await withUser(userId, async (tx) => {
    await ownNotebook(tx, userId, notebookId);
    await tx.delete(notebooks).where(eq(notebooks.id, notebookId));
  });
}

async function copyPage(tx: Tx, userId: string, p: typeof notebookPages.$inferSelect, target: { notebookId: string; sectionId: string; ord: number; title?: string }) {
  const [n] = await tx
    .insert(notebookPages)
    .values({
      userId,
      notebookId: target.notebookId,
      sectionId: target.sectionId,
      title: target.title ?? p.title,
      ord: target.ord,
      content: p.content,
      contentText: p.contentText,
      contentHash: p.contentHash,
      wordCount: p.wordCount,
    })
    .returning({ id: notebookPages.id });
  // Los libros vinculados se copian; los análisis y actividades permanecen en la página original
  const links = await tx.select().from(pageDocumentLinks).where(eq(pageDocumentLinks.pageId, p.id));
  if (links.length) await tx.insert(pageDocumentLinks).values(links.map((l) => ({ userId, pageId: n!.id, documentId: l.documentId })));
  return n!.id;
}

export async function duplicateNotebook(userId: string, notebookId: string) {
  return withUser(userId, async (tx) => {
    const nb = await ownNotebook(tx, userId, notebookId);
    const [copy] = await tx
      .insert(notebooks)
      .values({ userId, title: `${nb.title} (copia)`.slice(0, 200), subject: nb.subject, color: nb.color, ord: await nextOrd(tx, notebooks, eq(notebooks.userId, userId)) })
      .returning();
    const secs = await tx.select().from(notebookSections).where(eq(notebookSections.notebookId, notebookId)).orderBy(asc(notebookSections.ord));
    for (const s of secs) {
      const [ns] = await tx.insert(notebookSections).values({ userId, notebookId: copy!.id, title: s.title, ord: s.ord }).returning();
      const pages = await tx.select().from(notebookPages).where(eq(notebookPages.sectionId, s.id)).orderBy(asc(notebookPages.ord));
      for (const p of pages) await copyPage(tx, userId, p, { notebookId: copy!.id, sectionId: ns!.id, ord: p.ord });
    }
    return copy!;
  });
}

const idList = z.array(z.string().uuid()).max(2000);

export async function reorderNotebooks(userId: string, ids: unknown) {
  const list = idList.parse(ids);
  await withUser(userId, async (tx) => {
    for (const [i, id] of list.entries()) await tx.update(notebooks).set({ ord: i }).where(and(eq(notebooks.id, id), eq(notebooks.userId, userId)));
  });
}

// ───────────────────────────── Secciones ─────────────────────────────

export async function createSection(userId: string, notebookId: string, input: unknown) {
  const { title } = z.object({ title: titleSchema }).parse(input);
  return withUser(userId, async (tx) => {
    await ownNotebook(tx, userId, notebookId);
    const [s] = await tx
      .insert(notebookSections)
      .values({ userId, notebookId, title, ord: await nextOrd(tx, notebookSections, eq(notebookSections.notebookId, notebookId)) })
      .returning();
    return s!;
  });
}

export async function updateSection(userId: string, sectionId: string, input: unknown) {
  const data = z.object({ title: titleSchema.optional(), notebookId: z.string().uuid().optional() }).parse(input);
  return withUser(userId, async (tx) => {
    const s = await ownSection(tx, userId, sectionId);
    const patch: Partial<typeof notebookSections.$inferInsert> = {};
    if (data.title) patch.title = data.title;
    if (data.notebookId && data.notebookId !== s.notebookId) {
      // Mover la sección (con sus páginas) a otro cuaderno
      await ownNotebook(tx, userId, data.notebookId);
      patch.notebookId = data.notebookId;
      patch.ord = await nextOrd(tx, notebookSections, eq(notebookSections.notebookId, data.notebookId));
      await tx.update(notebookPages).set({ notebookId: data.notebookId }).where(eq(notebookPages.sectionId, sectionId));
    }
    const [r] = await tx.update(notebookSections).set(patch).where(eq(notebookSections.id, sectionId)).returning();
    return r!;
  });
}

export async function deleteSection(userId: string, sectionId: string) {
  await withUser(userId, async (tx) => {
    const s = await ownSection(tx, userId, sectionId);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(notebookSections).where(eq(notebookSections.notebookId, s.notebookId));
    if (n <= 1) throw new ConflictError("Un cuaderno necesita al menos una sección.");
    await tx.delete(notebookSections).where(eq(notebookSections.id, sectionId));
  });
}

export async function duplicateSection(userId: string, sectionId: string) {
  return withUser(userId, async (tx) => {
    const s = await ownSection(tx, userId, sectionId);
    const [ns] = await tx
      .insert(notebookSections)
      .values({ userId, notebookId: s.notebookId, title: `${s.title} (copia)`.slice(0, 200), ord: await nextOrd(tx, notebookSections, eq(notebookSections.notebookId, s.notebookId)) })
      .returning();
    const pages = await tx.select().from(notebookPages).where(eq(notebookPages.sectionId, sectionId)).orderBy(asc(notebookPages.ord));
    for (const p of pages) await copyPage(tx, userId, p, { notebookId: s.notebookId, sectionId: ns!.id, ord: p.ord });
    return ns!;
  });
}

export async function reorderSections(userId: string, notebookId: string, ids: unknown) {
  const list = idList.parse(ids);
  await withUser(userId, async (tx) => {
    await ownNotebook(tx, userId, notebookId);
    for (const [i, id] of list.entries())
      await tx.update(notebookSections).set({ ord: i }).where(and(eq(notebookSections.id, id), eq(notebookSections.notebookId, notebookId)));
  });
}

// ───────────────────────────── Páginas ─────────────────────────────

export async function createPage(userId: string, sectionId: string, input: unknown) {
  const { title } = z.object({ title: titleSchema.optional() }).parse(input ?? {});
  return withUser(userId, async (tx) => {
    const s = await ownSection(tx, userId, sectionId);
    const [p] = await tx
      .insert(notebookPages)
      .values({
        userId,
        notebookId: s.notebookId,
        sectionId,
        title: title ?? "Sin título",
        ord: await nextOrd(tx, notebookPages, eq(notebookPages.sectionId, sectionId)),
        content: EMPTY_DOC,
        ...derive(EMPTY_DOC),
      })
      .returning({ id: notebookPages.id });
    return { id: p!.id };
  });
}

/** «Nueva página» desde cualquier lugar: crea un cuaderno por defecto si el usuario no tiene ninguno. */
export async function quickCreatePage(userId: string) {
  const existing = await withUser(userId, (tx) => tx.select({ id: notebookSections.id }).from(notebookSections).where(eq(notebookSections.userId, userId)).orderBy(asc(notebookSections.createdAt)).limit(1));
  if (existing[0]) return createPage(userId, existing[0].id, {});
  const r = await createNotebook(userId, { title: "Mis apuntes" });
  return { id: r.pageId };
}

export async function getPage(userId: string, pageId: string) {
  return withUser(userId, async (tx) => {
    const p = await ownPage(tx, userId, pageId);
    const [nb] = await tx.select().from(notebooks).where(eq(notebooks.id, p.notebookId));
    const [sec] = await tx.select().from(notebookSections).where(eq(notebookSections.id, p.sectionId));
    const linked = await tx
      .select({ id: documents.id, title: documents.title, status: documents.status, pageCount: documents.pageCount, libraryName: libraries.name })
      .from(pageDocumentLinks)
      .innerJoin(documents, eq(documents.id, pageDocumentLinks.documentId))
      .innerJoin(libraries, eq(libraries.id, documents.libraryId))
      .where(eq(pageDocumentLinks.pageId, pageId));
    const [{ concepts: conceptCount } = { concepts: 0 }] = await tx
      .select({ concepts: sql<number>`count(*)::int` })
      .from(pageConceptLinks)
      .where(eq(pageConceptLinks.pageId, pageId));
    await tx.update(notebookPages).set({ lastOpenedAt: new Date() }).where(eq(notebookPages.id, pageId));
    return { page: p, notebook: nb!, section: sec!, linkedDocuments: linked, conceptCount };
  });
}

export const saveInput = z.object({
  baseVersion: z.number().int().min(1),
  title: titleSchema.optional(),
  content: z.unknown().optional(),
  /** Sobrescribir la versión del servidor tras un conflicto (decisión explícita del usuario). */
  force: z.boolean().optional(),
});

/**
 * Guardado con control de concurrencia optimista: si otro dispositivo guardó antes, se
 * devuelve un conflicto en lugar de pisar los cambios. Solo se confirma tras persistir.
 */
export async function savePage(userId: string, pageId: string, input: unknown) {
  const data = saveInput.parse(input);
  const content = data.content !== undefined ? sanitizeDoc(data.content) : undefined;
  return withUser(userId, async (tx) => {
    const [p] = await tx.select().from(notebookPages).where(and(eq(notebookPages.id, pageId), eq(notebookPages.userId, userId))).for("update");
    if (!p) throw new NotFoundError("Página");
    if (p.version !== data.baseVersion && !data.force)
      throw new VersionConflictError({ version: p.version, title: p.title, content: p.content, updatedAt: p.updatedAt });
    const now = new Date();
    const patch: Partial<typeof notebookPages.$inferInsert> = { version: p.version + 1, updatedAt: now };
    if (data.title !== undefined) patch.title = data.title;
    if (content) {
      const d = derive(content);
      if (d.contentHash !== p.contentHash || JSON.stringify(content) !== JSON.stringify(p.content)) {
        Object.assign(patch, { content, ...d });
        // Instantánea periódica de la versión anterior (historial recuperable)
        const [last] = await tx.select({ createdAt: pageVersions.createdAt }).from(pageVersions).where(eq(pageVersions.pageId, pageId)).orderBy(desc(pageVersions.createdAt)).limit(1);
        if (p.wordCount > 0 && (!last || now.getTime() - last.createdAt.getTime() > SNAPSHOT_EVERY_MS)) {
          await tx.insert(pageVersions).values({ userId, pageId, version: p.version, title: p.title, content: p.content, reason: "AUTO" });
          await pruneVersions(tx, pageId);
        }
      }
    }
    const [r] = await tx.update(notebookPages).set(patch).where(eq(notebookPages.id, pageId)).returning({ version: notebookPages.version, updatedAt: notebookPages.updatedAt, contentHash: notebookPages.contentHash, wordCount: notebookPages.wordCount, lastAnalyzedHash: notebookPages.lastAnalyzedHash });
    return r!;
  });
}

async function pruneVersions(tx: Tx, pageId: string) {
  const old = await tx.select({ id: pageVersions.id }).from(pageVersions).where(eq(pageVersions.pageId, pageId)).orderBy(desc(pageVersions.createdAt)).offset(MAX_VERSIONS);
  if (old.length) await tx.delete(pageVersions).where(inArray(pageVersions.id, old.map((o) => o.id)));
}

export async function snapshotPage(tx: Tx, userId: string, pageId: string, reason: "BEFORE_CORRECTION" | "BEFORE_RESTORE" | "MANUAL") {
  const p = await ownPage(tx, userId, pageId);
  await tx.insert(pageVersions).values({ userId, pageId, version: p.version, title: p.title, content: p.content, reason });
  await pruneVersions(tx, pageId);
}

export async function listVersions(userId: string, pageId: string) {
  return withUser(userId, async (tx) => {
    await ownPage(tx, userId, pageId);
    return tx
      .select({ id: pageVersions.id, version: pageVersions.version, title: pageVersions.title, reason: pageVersions.reason, createdAt: pageVersions.createdAt })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(desc(pageVersions.createdAt));
  });
}

export async function getVersion(userId: string, versionId: string) {
  return withUser(userId, async (tx) => {
    const [v] = await tx.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.userId, userId)));
    if (!v) throw new NotFoundError("Versión");
    return v;
  });
}

export async function restoreVersion(userId: string, versionId: string) {
  return withUser(userId, async (tx) => {
    const [v] = await tx.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.userId, userId)));
    if (!v) throw new NotFoundError("Versión");
    await snapshotPage(tx, userId, v.pageId, "BEFORE_RESTORE");
    const p = await ownPage(tx, userId, v.pageId);
    const [r] = await tx
      .update(notebookPages)
      .set({ content: v.content, title: v.title, ...derive(v.content), version: p.version + 1, updatedAt: new Date() })
      .where(eq(notebookPages.id, v.pageId))
      .returning({ version: notebookPages.version });
    return { pageId: v.pageId, version: r!.version };
  });
}

export const pagePatch = z.object({
  title: titleSchema.optional(),
  sectionId: z.string().uuid().optional(),
  index: z.number().int().min(0).max(10_000).optional(),
});

/** Renombrar o mover una página (a otra sección o cuaderno) conservando su identidad. */
export async function updatePageMeta(userId: string, pageId: string, input: unknown) {
  const data = pagePatch.parse(input);
  return withUser(userId, async (tx) => {
    const p = await ownPage(tx, userId, pageId);
    const targetSectionId = data.sectionId ?? p.sectionId;
    const target = targetSectionId === p.sectionId ? null : await ownSection(tx, userId, targetSectionId);
    if (data.title) await tx.update(notebookPages).set({ title: data.title, version: p.version + 1, updatedAt: new Date() }).where(eq(notebookPages.id, pageId));
    if (target || data.index !== undefined) {
      const siblings = (
        await tx.select({ id: notebookPages.id }).from(notebookPages).where(eq(notebookPages.sectionId, targetSectionId)).orderBy(asc(notebookPages.ord), asc(notebookPages.createdAt))
      )
        .map((s) => s.id)
        .filter((id) => id !== pageId);
      const idx = Math.min(data.index ?? siblings.length, siblings.length);
      siblings.splice(idx, 0, pageId);
      if (target) await tx.update(notebookPages).set({ sectionId: target.id, notebookId: target.notebookId }).where(eq(notebookPages.id, pageId));
      for (const [i, id] of siblings.entries()) await tx.update(notebookPages).set({ ord: i }).where(eq(notebookPages.id, id));
    }
    return { ok: true };
  });
}

export async function duplicatePage(userId: string, pageId: string) {
  return withUser(userId, async (tx) => {
    const p = await ownPage(tx, userId, pageId);
    const id = await copyPage(tx, userId, p, { notebookId: p.notebookId, sectionId: p.sectionId, ord: p.ord + 1, title: `${p.title} (copia)`.slice(0, 200) });
    await tx.update(notebookPages).set({ ord: sql`${notebookPages.ord} + 1` }).where(and(eq(notebookPages.sectionId, p.sectionId), gt(notebookPages.ord, p.ord), sql`${notebookPages.id} <> ${id}`));
    return { id };
  });
}

export async function deletePage(userId: string, pageId: string) {
  await withUser(userId, async (tx) => {
    await ownPage(tx, userId, pageId);
    await tx.delete(notebookPages).where(eq(notebookPages.id, pageId));
  });
}

export async function recentPages(userId: string, limit = 6) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: notebookPages.id,
        title: notebookPages.title,
        updatedAt: notebookPages.updatedAt,
        wordCount: notebookPages.wordCount,
        notebookTitle: notebooks.title,
        notebookColor: notebooks.color,
        sectionTitle: notebookSections.title,
      })
      .from(notebookPages)
      .innerJoin(notebooks, eq(notebooks.id, notebookPages.notebookId))
      .innerJoin(notebookSections, eq(notebookSections.id, notebookPages.sectionId))
      .where(eq(notebookPages.userId, userId))
      .orderBy(desc(notebookPages.updatedAt))
      .limit(limit),
  );
}

export async function searchPages(userId: string, q: string, limit = 20) {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  return withUser(userId, async (tx) => {
    const res = await tx.execute(sql`
      select p.id, p.title, n.title as notebook_title, s.title as section_title,
             ts_headline('spanish', p.content_text, websearch_to_tsquery('spanish', ${query}), 'MaxWords=18, MinWords=8, StartSel=«, StopSel=»') as snippet
      from notebook_pages p
      join notebooks n on n.id = p.notebook_id
      join notebook_sections s on s.id = p.section_id
      where p.user_id = ${userId} and (p.search_tsv @@ websearch_to_tsquery('spanish', ${query}) or p.title ilike ${"%" + query.replace(/[%_]/g, "") + "%"})
      order by ts_rank(p.search_tsv, websearch_to_tsquery('spanish', ${query})) desc, p.updated_at desc
      limit ${limit}`);
    return res.rows as { id: string; title: string; notebook_title: string; section_title: string; snippet: string }[];
  });
}

// ───────────────────────────── Libros vinculados ─────────────────────────────

export async function linkDocument(userId: string, pageId: string, documentId: string) {
  await withUser(userId, async (tx) => {
    await ownPage(tx, userId, pageId);
    const [d] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    if (!d) throw new NotFoundError("Documento");
    await tx.insert(pageDocumentLinks).values({ userId, pageId, documentId }).onConflictDoNothing();
  });
}

export async function unlinkDocument(userId: string, pageId: string, documentId: string) {
  await withUser(userId, async (tx) => {
    await ownPage(tx, userId, pageId);
    await tx.delete(pageDocumentLinks).where(and(eq(pageDocumentLinks.pageId, pageId), eq(pageDocumentLinks.documentId, documentId)));
  });
}

// ───────────────────────────── Imágenes ─────────────────────────────

const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG",
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "image/gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
};

export async function saveAsset(userId: string, pageId: string | null, data: Buffer) {
  if (data.length > 10 * 1024 * 1024) throw new ConflictError("La imagen supera 10 MB.");
  const mime = Object.entries(IMAGE_TYPES).find(([, test]) => test(data))?.[0];
  if (!mime) throw new ConflictError("Formato de imagen no admitido (PNG, JPG, WEBP o GIF).");
  if (pageId) await withUser(userId, (tx) => ownPage(tx, userId, pageId));
  const storageKey = await saveFile(userId, data);
  const [a] = await withUser(userId, (tx) => tx.insert(noteAssets).values({ userId, pageId, storageKey, mimeType: mime, sizeBytes: data.length }).returning());
  return { id: a!.id, src: `/api/notes/assets/${a!.id}` };
}

export async function readAsset(userId: string, assetId: string) {
  const [a] = await withUser(userId, (tx) => tx.select().from(noteAssets).where(and(eq(noteAssets.id, assetId), eq(noteAssets.userId, userId))));
  if (!a) throw new NotFoundError("Imagen");
  return { data: await readStoredFile(a.storageKey), mimeType: a.mimeType };
}
