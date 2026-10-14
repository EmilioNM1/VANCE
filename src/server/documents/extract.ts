import JSZip from "jszip";
import { z } from "zod";
import type { SupportedKind } from "./file-validation";

export interface Block {
  kind: "heading" | "paragraph" | "figure_unreadable";
  level?: number;
  text: string;
}

export interface ExtractedPage {
  /** Número de página/diapositiva (1-based) o null si el formato no tiene páginas. */
  page: number | null;
  blocks: Block[];
}

export interface ExtractedDoc {
  pages: ExtractedPage[];
  pageCount: number | null;
  method: "pdf-text" | "ocr-ai" | "docx" | "pptx" | "text" | "vision-ai";
  warnings: string[];
  titleGuess?: string;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    public code: "NO_TEXT_NEEDS_OCR" | "TOO_MANY_PAGES" | "CORRUPT" | "EMPTY",
  ) {
    super(message);
  }
}

/** Función de OCR inyectable (la implementación real usa la IA con visión). */
export type OcrFn = (input: { kind: "pdf" | "image"; data: Buffer; mimeType: string }) => Promise<ExtractedPage[]>;

const MIN_CHARS_PER_PAGE = 15;

export async function extractDocument(kind: SupportedKind, data: Buffer, mimeType: string, ocr: OcrFn | null): Promise<ExtractedDoc> {
  switch (kind) {
    case "pdf":
      return extractPdf(data, ocr);
    case "docx":
      return extractDocx(data);
    case "pptx":
      return extractPptx(data);
    case "txt":
    case "md":
      return extractText(data.toString("utf8"));
    case "image": {
      if (!ocr)
        throw new ExtractionError(
          "Las imágenes de apuntes requieren reconocimiento visual con IA, que no está configurada.",
          "NO_TEXT_NEEDS_OCR",
        );
      const pages = await ocr({ kind: "image", data, mimeType });
      return { pages, pageCount: 1, method: "vision-ai", warnings: collectFigureWarnings(pages) };
    }
  }
}

// ───────────────────────────── PDF ─────────────────────────────

async function extractPdf(data: Buffer, ocr: OcrFn | null): Promise<ExtractedDoc> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch {
    throw new ExtractionError("No se pudo abrir el PDF (puede estar dañado o protegido con contraseña).", "CORRUPT");
  }
  const maxPages = Number(process.env.MAX_PAGES_PER_DOCUMENT ?? 400);
  if (pdf.numPages > maxPages)
    throw new ExtractionError(`El PDF tiene ${pdf.numPages} páginas; el máximo permitido es ${maxPages}. Divídelo por capítulos.`, "TOO_MANY_PAGES");
  const { text } = await extractText(pdf, { mergePages: false });
  const pagesText = text as string[];
  const totalChars = pagesText.reduce((a, t) => a + t.replace(/\s/g, "").length, 0);
  const warnings: string[] = [];

  if (totalChars / Math.max(1, pdf.numPages) < MIN_CHARS_PER_PAGE) {
    if (!ocr)
      throw new ExtractionError(
        "Este PDF no contiene texto extraíble (parece escaneado). Para procesarlo se necesita OCR con IA, que no está configurada.",
        "NO_TEXT_NEEDS_OCR",
      );
    const pages = await ocr({ kind: "pdf", data, mimeType: "application/pdf" });
    if (!pages.some((p) => p.blocks.some((b) => b.text.trim())))
      throw new ExtractionError("El OCR no encontró texto legible en el PDF.", "EMPTY");
    return {
      pages,
      pageCount: pdf.numPages,
      method: "ocr-ai",
      warnings: ["Texto obtenido mediante OCR: revisa los fragmentos por si hay errores de reconocimiento.", ...collectFigureWarnings(pages)],
    };
  }

  const pages: ExtractedPage[] = pagesText.map((t, i) => ({ page: i + 1, blocks: pdfTextToBlocks(t) }));
  const emptyPages = pages.filter((p) => p.blocks.length === 0).map((p) => p.page);
  if (emptyPages.length)
    warnings.push(
      `Páginas sin texto extraíble (pueden contener solo imágenes o diagramas no interpretados): ${emptyPages.slice(0, 20).join(", ")}${emptyPages.length > 20 ? "…" : ""}.`,
    );
  return { pages, pageCount: pdf.numPages, method: "pdf-text", warnings };
}

const HEADING_RE =
  /^((cap[ií]tulo|chapter|tema|unidad|secci[oó]n|parte|lecci[oó]n|bloque)\s+[\dIVXLC]+\b.*|\d{1,2}(\.\d{1,2}){0,3}\.?\s+[A-ZÁÉÍÓÚÑ¿][^.!?]{2,80})$/i;

export function looksLikeHeading(line: string): { level: number } | null {
  const l = line.trim();
  if (l.length < 3 || l.length > 90 || /[.,;:]$/.test(l)) return null;
  if (/^(cap[ií]tulo|chapter|tema|unidad|parte|bloque)\b/i.test(l) && HEADING_RE.test(l)) return { level: 1 };
  const num = l.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+\S/);
  if (num && HEADING_RE.test(l)) return { level: Math.min(3, num[1]!.split(".").length) };
  const letters = l.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const words = l.split(/\s+/).length;
  if (letters.length >= 4 && letters === letters.toUpperCase() && words <= 8 && !/\d{3,}/.test(l)) return { level: 2 };
  return null;
}

export function pdfTextToBlocks(pageText: string): Block[] {
  const lines = pageText
    .replace(/(\w)-\n(\w)/g, "$1$2") // une palabras cortadas por guion al final de línea
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim());
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    const t = para.join(" ").trim();
    if (t) blocks.push({ kind: "paragraph", text: t });
    para = [];
  };
  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (/^\d{1,4}$/.test(line)) continue; // números de página sueltos
    const h = looksLikeHeading(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h.level, text: line });
    } else {
      para.push(line);
      if (/[.!?:]$/.test(line) && para.join(" ").length > 600) flush();
    }
  }
  flush();
  return blocks;
}

// ───────────────────────────── DOCX ─────────────────────────────

function decodeEntities(s: string) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractDocx(data: Buffer): Promise<ExtractedDoc> {
  const mammoth = await import("mammoth");
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: data }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) })).value;
  } catch {
    throw new ExtractionError("No se pudo leer el documento DOCX.", "CORRUPT");
  }
  const blocks: Block[] = [];
  let images = 0;
  const re = /<(h[1-6]|p|li|table)[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1]!;
    const inner = m[2]!;
    images += (inner.match(/<img/g) ?? []).length;
    if (tag === "table") {
      const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
        [...r[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => decodeEntities(c[1]!)).join(" | "),
      );
      const t = rows.filter(Boolean).join("\n");
      if (t) blocks.push({ kind: "paragraph", text: `Tabla:\n${t}` });
      continue;
    }
    const text = decodeEntities(inner);
    if (!text) continue;
    if (tag.startsWith("h")) blocks.push({ kind: "heading", level: Number(tag[1]), text });
    else blocks.push({ kind: "paragraph", text: tag === "li" ? `• ${text}` : text });
  }
  if (!blocks.length) throw new ExtractionError("El documento DOCX no contiene texto.", "EMPTY");
  const warnings = images
    ? [`El documento contiene ${images} imagen(es) o diagrama(s) que NO se han interpretado; su contenido no forma parte del conocimiento extraído.`]
    : [];
  return { pages: [{ page: null, blocks }], pageCount: null, method: "docx", warnings };
}

// ───────────────────────────── PPTX ─────────────────────────────

async function extractPptx(data: Buffer): Promise<ExtractedDoc> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ExtractionError("No se pudo leer la presentación.", "CORRUPT");
  }
  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => Number(a.name.match(/(\d+)\.xml$/)![1]) - Number(b.name.match(/(\d+)\.xml$/)![1]));
  const pages: ExtractedPage[] = [];
  let pictures = 0;
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await slideFiles[i]!.async("string");
    pictures += (xml.match(/<p:pic>/g) ?? []).length;
    const blocks: Block[] = [];
    for (const sp of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
      const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(sp);
      const paras = (sp.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [])
        .map((p) => decodeEntities((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((t) => t.replace(/<\/?a:t>/g, "")).join("")))
        .filter(Boolean);
      if (!paras.length) continue;
      if (isTitle) blocks.push({ kind: "heading", level: 2, text: paras.join(" ") });
      else for (const p of paras) blocks.push({ kind: "paragraph", text: p });
    }
    pages.push({ page: i + 1, blocks });
  }
  if (!pages.some((p) => p.blocks.length)) throw new ExtractionError("La presentación no contiene texto.", "EMPTY");
  const warnings = pictures
    ? [`La presentación contiene ${pictures} imagen(es) o diagrama(s) que NO se han interpretado.`]
    : [];
  return { pages, pageCount: slideFiles.length, method: "pptx", warnings };
}

// ───────────────────────────── TXT / Markdown ─────────────────────────────

export function extractText(raw: string): ExtractedDoc {
  const text = raw.replace(/\r\n?/g, "\n");
  const blocks: Block[] = [];
  for (const part of text.split(/\n{2,}/)) {
    const lines = part.split("\n");
    let buf: string[] = [];
    for (const line of lines) {
      const md = line.match(/^(#{1,6})\s+(.+)$/);
      if (md) {
        if (buf.length) blocks.push({ kind: "paragraph", text: buf.join(" ").trim() });
        buf = [];
        blocks.push({ kind: "heading", level: md[1]!.length, text: md[2]!.trim() });
      } else if (line.trim()) buf.push(line.trim());
    }
    if (buf.length) blocks.push({ kind: "paragraph", text: buf.join(" ").trim() });
  }
  if (!blocks.length) throw new ExtractionError("El archivo de texto está vacío.", "EMPTY");
  return { pages: [{ page: null, blocks }], pageCount: null, method: "text", warnings: [] };
}

function collectFigureWarnings(pages: ExtractedPage[]): string[] {
  const figs = pages.flatMap((p) => p.blocks.filter((b) => b.kind === "figure_unreadable").map((b) => ({ page: p.page, text: b.text })));
  return figs.map((f) => `Figura no interpretable${f.page ? ` (pág. ${f.page})` : ""}: ${f.text}`);
}

// ───────────────────────────── Estructura: secciones y fragmentos ─────────────────────────────

export interface StructuredSection {
  title: string;
  level: number;
  pageStart: number | null;
  pageEnd: number | null;
  chunks: { text: string; page: number | null; warnings: string[] }[];
}

const CHUNK_TARGET = 1400;

/** Agrupa bloques en secciones (por encabezados) y fragmentos de ~1400 caracteres con su página de origen. */
export function structure(doc: ExtractedDoc, fallbackTitle: string): StructuredSection[] {
  const out: StructuredSection[] = [];
  let current: StructuredSection | null = null;
  let buf: { text: string; page: number | null; warnings: string[] } | null = null;

  const flushChunk = () => {
    if (buf && buf.text.trim() && current) current.chunks.push({ ...buf, text: buf.text.trim() });
    buf = null;
  };
  const ensureSection = (page: number | null) => {
    if (!current) {
      current = { title: fallbackTitle, level: 1, pageStart: page, pageEnd: page, chunks: [] };
      out.push(current);
    }
    return current;
  };

  for (const p of doc.pages) {
    for (const b of p.blocks) {
      if (b.kind === "heading") {
        flushChunk();
        // Un encabezado sin contenido previo fusiona con el anterior (p. ej. "Capítulo 3" + "Músculo")
        const cur = current as StructuredSection | null;
        if (cur && cur.chunks.length === 0 && cur.title !== fallbackTitle && cur.title.length + b.text.length < 120) {
          cur.title = `${cur.title} — ${b.text}`;
          continue;
        }
        current = { title: b.text, level: b.level ?? 1, pageStart: p.page, pageEnd: p.page, chunks: [] };
        out.push(current);
        continue;
      }
      const sec = ensureSection(p.page);
      sec.pageEnd = p.page ?? sec.pageEnd;
      const text = b.kind === "figure_unreadable" ? `[Figura no interpretada: ${b.text}]` : b.text;
      const warn = b.kind === "figure_unreadable" ? ["Contiene una figura que no se pudo interpretar."] : [];
      // Un fragmento nunca mezcla páginas: así cada concepto conserva su página exacta
      const pending = buf as { text: string; page: number | null } | null;
      if (pending && (pending.page !== p.page || pending.text.length + text.length > CHUNK_TARGET)) flushChunk();
      if (!buf) buf = { text: "", page: p.page, warnings: [] };
      const cb = buf as { text: string; page: number | null; warnings: string[] };
      cb.text += (cb.text ? "\n\n" : "") + text;
      cb.warnings.push(...warn);
      // Párrafos muy largos se cortan por oraciones
      while (cb.text.length > CHUNK_TARGET * 1.6) {
        const cut = cb.text.lastIndexOf(". ", CHUNK_TARGET) + 1 || CHUNK_TARGET;
        sec.chunks.push({ text: cb.text.slice(0, cut).trim(), page: cb.page, warnings: [...cb.warnings] });
        cb.text = cb.text.slice(cut).trim();
        cb.page = p.page;
      }
    }
  }
  flushChunk();
  return out.filter((s) => s.chunks.length > 0);
}

// ───────────────────────────── OCR con IA (esquema) ─────────────────────────────

export const ocrSchema = z.object({
  pages: z.array(
    z.object({
      page: z.number(),
      blocks: z.array(
        z.object({
          kind: z.enum(["heading", "paragraph", "figure_unreadable"]),
          level: z.number(),
          text: z.string(),
        }),
      ),
    }),
  ),
});
