import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withUser } from "@/db/client";
import { notebookPages, pageVersions } from "@/db/schema";
import {
  createNotebook,
  createPage,
  createSection,
  deletePage,
  deleteSection,
  duplicatePage,
  duplicateSection,
  getNotebookTree,
  getPage,
  listNotebooks,
  listVersions,
  quickCreatePage,
  recentPages,
  restoreVersion,
  savePage,
  searchPages,
  updatePageMeta,
  updateSection,
  VersionConflictError,
} from "@/server/notebooks/service";
import { ContentValidationError, docToMarkdown, docToText, sanitizeDoc } from "@/server/notebooks/content";
import { exportDocx, exportMarkdown, exportPdf, exportText } from "@/server/notebooks/export";
import { NotFoundError } from "@/server/documents/service";
import { makeUser } from "../helpers/db";
import type { NoteDoc } from "@/lib/types";

const RICH: NoteDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Contracción muscular" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "El " },
        { type: "text", text: "calcio", marks: [{ type: "bold" }] },
        { type: "text", text: " se une a la troponina C (α y β ±)." },
      ],
    },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Túbulos T" }] }] }] },
    { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Acetilcolina" }] }] }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Repasar SERCA" }] }] }] },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Cita del libro" }] }] },
    { type: "blockMath", attrs: { latex: "E = \\frac{RT}{zF} \\ln \\frac{[X]_o}{[X]_i}" } },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Proteína" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Función" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Troponina" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Fija calcio" }] }] }] },
      ],
    },
    { type: "horizontalRule" },
    { type: "paragraph", content: [{ type: "text", text: "Enlace", marks: [{ type: "link", attrs: { href: "https://pubmed.ncbi.nlm.nih.gov/" } }] }] },
  ],
};

describe("contenido del editor", () => {
  it("rechaza nodos desconocidos, imágenes externas y enlaces peligrosos", () => {
    expect(() => sanitizeDoc({ type: "doc", content: [{ type: "script", text: "x" }] })).toThrow(ContentValidationError);
    expect(() => sanitizeDoc({ type: "doc", content: [{ type: "image", attrs: { src: "https://evil.example/x.png" } }] })).toThrow(ContentValidationError);
    const d = sanitizeDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] });
    expect(JSON.stringify(d)).not.toContain("javascript");
    expect(() => sanitizeDoc({ type: "paragraph" })).toThrow(ContentValidationError);
  });
  it("convierte a texto y Markdown conservando la estructura", () => {
    const t = docToText(sanitizeDoc(RICH));
    expect(t).toContain("El calcio se une a la troponina C");
    expect(t).toContain("[x] Repasar SERCA");
    const md = docToMarkdown(sanitizeDoc(RICH), "Fisiología");
    expect(md).toContain("# Fisiología");
    expect(md).toContain("## Contracción muscular");
    expect(md).toContain("**calcio**");
    expect(md).toContain("- Túbulos T");
    expect(md).toContain("1. Acetilcolina");
    expect(md).toContain("- [x] Repasar SERCA");
    expect(md).toContain("> Cita del libro");
    expect(md).toContain("$$");
    expect(md).toContain("| Proteína | Función |");
    expect(md).toContain("[Enlace](https://pubmed.ncbi.nlm.nih.gov/)");
  });
  it("exporta a DOCX, PDF, Markdown y TXT reales", async () => {
    const doc = sanitizeDoc(RICH);
    const docx = await exportDocx(doc, "Fisiología", async () => null);
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    expect(docx.length).toBeGreaterThan(3000);
    const pdf = await exportPdf(doc, "Fisiología", async () => null);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5000);
    expect(exportMarkdown(doc, "F")).toContain("**calcio**");
    expect(exportText(doc, "F")).toContain("Túbulos T");
  });
});

describe("cuadernos, secciones y páginas", () => {
  it("crear un cuaderno deja una sección y una página listas para escribir", async () => {
    const u = await makeUser();
    const r = await createNotebook(u.id, { title: "Fisiología", subject: "Medicina" });
    const tree = await getNotebookTree(u.id, r.notebook.id);
    expect(tree.sections).toHaveLength(1);
    expect(tree.sections[0]!.pages.map((p) => p.id)).toEqual([r.pageId]);
    const page = await getPage(u.id, r.pageId);
    expect(page.notebook.title).toBe("Fisiología");
    expect(page.section.title).toBe("General");
  });

  it("guardado con control de versiones: confirma, detecta conflictos y permite forzar", async () => {
    const u = await makeUser();
    const { pageId } = await createNotebook(u.id, { title: "N" });
    const s1 = await savePage(u.id, pageId, { baseVersion: 1, title: "Sarcómero", content: RICH });
    expect(s1.version).toBe(2);
    expect(s1.wordCount).toBeGreaterThan(10);
    // Otro dispositivo guarda con una versión antigua → conflicto, sin perder nada
    await expect(savePage(u.id, pageId, { baseVersion: 1, content: { type: "doc", content: [] } })).rejects.toBeInstanceOf(VersionConflictError);
    const p = await getPage(u.id, pageId);
    expect(p.page.title).toBe("Sarcómero");
    expect(p.page.contentText).toContain("troponina");
    const forced = await savePage(u.id, pageId, { baseVersion: 1, content: { type: "doc", content: [{ type: "paragraph" }] }, force: true });
    expect(forced.version).toBe(3);
  });

  it("guarda versiones anteriores y permite restaurarlas sin perder la actual", async () => {
    const u = await makeUser();
    const { pageId } = await createNotebook(u.id, { title: "N" });
    await savePage(u.id, pageId, { baseVersion: 1, content: RICH });
    // Fuerza que la última instantánea sea "antigua"
    await savePage(u.id, pageId, { baseVersion: 2, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto nuevo" }] }] } });
    const versions = await listVersions(u.id, pageId);
    expect(versions.length).toBe(1);
    const restored = await restoreVersion(u.id, versions[0]!.id);
    const p = await getPage(u.id, pageId);
    expect(p.page.contentText).toContain("troponina");
    expect(restored.version).toBeGreaterThan(3);
    const after = await listVersions(u.id, pageId);
    expect(after.some((v) => v.reason === "BEFORE_RESTORE")).toBe(true);
  });

  it("mover, reordenar, renombrar, duplicar y eliminar conservando la identidad de la página", async () => {
    const u = await makeUser();
    const { notebook, sectionId, pageId } = await createNotebook(u.id, { title: "Fisiología" });
    const sec2 = await createSection(u.id, notebook.id, { title: "Fisiología muscular" });
    const p2 = await createPage(u.id, sec2.id, { title: "Sarcómero" });
    const p3 = await createPage(u.id, sec2.id, { title: "Contracción" });
    await updatePageMeta(u.id, pageId, { sectionId: sec2.id, index: 0, title: "Acoplamiento" });
    let tree = await getNotebookTree(u.id, notebook.id);
    expect(tree.sections.find((s) => s.id === sec2.id)!.pages.map((p) => p.id)).toEqual([pageId, p2.id, p3.id]);
    expect(tree.sections.find((s) => s.id === sectionId)!.pages).toHaveLength(0);
    const dup = await duplicatePage(u.id, p2.id);
    tree = await getNotebookTree(u.id, notebook.id);
    expect(tree.sections.find((s) => s.id === sec2.id)!.pages.map((p) => p.id)).toEqual([pageId, p2.id, dup.id, p3.id]);
    const dupSec = await duplicateSection(u.id, sec2.id);
    tree = await getNotebookTree(u.id, notebook.id);
    expect(tree.sections.find((s) => s.id === dupSec.id)!.pages).toHaveLength(4);
    // Mover una sección a otro cuaderno mueve también sus páginas
    const other = await createNotebook(u.id, { title: "Anatomía" });
    await updateSection(u.id, dupSec.id, { notebookId: other.notebook.id });
    const otherTree = await getNotebookTree(u.id, other.notebook.id);
    expect(otherTree.sections.find((s) => s.id === dupSec.id)!.pages).toHaveLength(4);
    const moved = await withUser(u.id, (tx) => tx.select().from(notebookPages).where(eq(notebookPages.sectionId, dupSec.id)));
    expect(moved.every((p) => p.notebookId === other.notebook.id)).toBe(true);
    await deletePage(u.id, p3.id);
    await expect(getPage(u.id, p3.id)).rejects.toBeInstanceOf(NotFoundError);
    // No se puede dejar un cuaderno sin secciones
    await expect(deleteSection(u.id, otherTree.sections.find((s) => s.id !== dupSec.id)!.id)).resolves.toBeUndefined();
    await expect(deleteSection(u.id, dupSec.id)).rejects.toThrow(/al menos una sección/);
    expect((await listNotebooks(u.id)).length).toBe(2);
  });

  it("búsqueda, páginas recientes y creación rápida", async () => {
    const u = await makeUser();
    const quick = await quickCreatePage(u.id);
    const nbs = await listNotebooks(u.id);
    expect(nbs[0]!.title).toBe("Mis apuntes");
    await savePage(u.id, quick.id, { baseVersion: 1, title: "Potencial de membrana", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "La bomba sodio-potasio mantiene los gradientes iónicos." }] }] } });
    const res = await searchPages(u.id, "gradientes bomba");
    expect(res[0]!.id).toBe(quick.id);
    expect((await recentPages(u.id))[0]!.title).toBe("Potencial de membrana");
  });

  it("aislamiento: nadie puede leer, guardar ni mover las páginas de otro", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { pageId, sectionId, notebook } = await createNotebook(a.id, { title: "Privado" });
    await expect(getPage(b.id, pageId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(savePage(b.id, pageId, { baseVersion: 1, content: RICH })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getNotebookTree(b.id, notebook.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createPage(b.id, sectionId, {})).rejects.toBeInstanceOf(NotFoundError);
    const bSec = (await createNotebook(b.id, { title: "B" })).sectionId;
    await expect(updatePageMeta(a.id, pageId, { sectionId: bSec })).rejects.toBeInstanceOf(NotFoundError);
    expect(await searchPages(b.id, "Privado")).toHaveLength(0);
    const versions = await withUser(b.id, (tx) => tx.select().from(pageVersions));
    expect(versions).toHaveLength(0);
  });
});
