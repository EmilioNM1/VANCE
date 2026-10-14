import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocument, ExtractionError, extractText, looksLikeHeading, pdfTextToBlocks, structure } from "@/server/documents/extract";
import { validateUpload, FileValidationError } from "@/server/documents/file-validation";
import { makePdf } from "../helpers/pdf";

describe("lectura de documentos", () => {
  it("detecta encabezados típicos de libros", () => {
    expect(looksLikeHeading("Capítulo 3 Fisiología muscular")).toEqual({ level: 1 });
    expect(looksLikeHeading("3.2 Acoplamiento excitación-contracción")).toEqual({ level: 2 });
    expect(looksLikeHeading("CONTRACCIÓN MUSCULAR")).toEqual({ level: 2 });
    expect(looksLikeHeading("El calcio se une a la troponina.")).toBeNull();
  });
  it("une palabras cortadas por guion y agrupa párrafos", () => {
    const blocks = pdfTextToBlocks("1. Introducción\nLa contrac-\nción muscular depende\ndel calcio.\n\n12");
    expect(blocks[0]).toMatchObject({ kind: "heading" });
    expect(blocks[1]!.text).toBe("La contracción muscular depende del calcio.");
    expect(blocks).toHaveLength(2);
  });
  it("extrae PDF con texto conservando el número de página", async () => {
    const pdf = makePdf([["Capitulo 1 Musculo", "El calcio se une a la troponina C."], ["La miosina hidroliza ATP."]]);
    const doc = await extractDocument("pdf", pdf, "application/pdf", null);
    expect(doc.method).toBe("pdf-text");
    expect(doc.pageCount).toBe(2);
    const secs = structure(doc, "Doc");
    expect(secs[0]!.chunks.map((c) => c.page)).toContain(1);
    expect(secs.flatMap((s) => s.chunks).some((c) => c.page === 2 && c.text.includes("miosina"))).toBe(true);
  });
  it("un PDF sin texto extraíble se indica claramente cuando no hay OCR", async () => {
    const pdf = makePdf([[], []]);
    await expect(extractDocument("pdf", pdf, "application/pdf", null)).rejects.toMatchObject({ code: "NO_TEXT_NEEDS_OCR" });
  });
  it("un PDF escaneado usa OCR si está disponible y avisa de figuras no interpretables", async () => {
    const pdf = makePdf([[]]);
    const doc = await extractDocument("pdf", pdf, "application/pdf", async () => [
      { page: 1, blocks: [{ kind: "paragraph", text: "Texto reconocido" }, { kind: "figure_unreadable", text: "Diagrama del sarcómero ilegible" }] },
    ]);
    expect(doc.method).toBe("ocr-ai");
    expect(doc.warnings.join(" ")).toMatch(/Figura no interpretable/);
    const secs = structure(doc, "Doc");
    expect(secs[0]!.chunks[0]!.text).toMatch(/\[Figura no interpretada/);
  });
  it("lee Markdown con encabezados", () => {
    const doc = extractText("# Tema 1\n\nPárrafo uno.\n\n## Sub\nPárrafo dos.");
    const secs = structure(doc, "X");
    expect(secs.map((s) => s.title)).toEqual(["Tema 1", "Sub"]);
  });
  it("lee PPTX: títulos de diapositiva y viñetas", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p:presentation/>");
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Contracción</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>El Ca2+ se une a la troponina</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    expect((await validateUpload("a.pptx", buf)).kind).toBe("pptx");
    const doc = await extractDocument("pptx", buf, "", null);
    expect(doc.pages[0]!.blocks).toEqual([
      { kind: "heading", level: 2, text: "Contracción" },
      { kind: "paragraph", text: "El Ca2+ se une a la troponina" },
    ]);
  });
});

describe("validación de archivos", () => {
  it("rechaza archivos cuyo contenido no coincide con la extensión", async () => {
    await expect(validateUpload("x.pdf", Buffer.from("MZ\x90\x00 ejecutable"))).rejects.toBeInstanceOf(FileValidationError);
    await expect(validateUpload("x.exe", Buffer.from("hola"))).rejects.toBeInstanceOf(FileValidationError);
    await expect(validateUpload("x.txt", Buffer.from([0x68, 0, 0x69]))).rejects.toBeInstanceOf(FileValidationError);
  });
  it("rechaza archivos vacíos o demasiado grandes", async () => {
    await expect(validateUpload("x.txt", Buffer.alloc(0))).rejects.toThrow(/vacío/);
    process.env.MAX_UPLOAD_MB = "0.0001";
    await expect(validateUpload("x.txt", Buffer.alloc(500, 97))).rejects.toThrow(/tamaño máximo/);
    delete process.env.MAX_UPLOAD_MB;
  });
  it("rechaza documentos Office con macros", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    zip.file("word/vbaProject.bin", "x");
    await expect(validateUpload("m.docx", await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(/macros/);
  });
  it("ExtractionError expone un código", () => {
    expect(new ExtractionError("x", "EMPTY").code).toBe("EMPTY");
  });
});
