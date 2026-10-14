/**
 * Exportación de apuntes a DOCX, PDF, Markdown y TXT a partir del documento validado.
 * Las fórmulas se exportan como su código LaTeX (no se rasterizan).
 */
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import PDFDocument from "pdfkit";
import type { NoteNode } from "@/lib/types";
import { docToMarkdown, docToText } from "./content";

export type AssetLoader = (assetId: string) => Promise<{ data: Buffer; mimeType: string } | null>;

/** Dimensiones de PNG/JPEG/GIF leyendo la cabecera (sin dependencias). */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

function fit(size: { width: number; height: number }, maxW: number) {
  const w = Math.min(maxW, size.width);
  return { width: Math.round(w), height: Math.round((size.height * w) / size.width) };
}

const assetIdOf = (src: unknown) => (typeof src === "string" ? src.split("/").pop()! : "");

export function exportMarkdown(doc: NoteNode, title: string) {
  return docToMarkdown(doc, title);
}

export function exportText(doc: NoteNode, title: string) {
  return `${title}\n${"=".repeat(Math.min(80, title.length))}\n\n${docToText(doc)}\n`;
}

// ───────────────────────────── DOCX ─────────────────────────────

export async function exportDocx(doc: NoteNode, title: string, loadAsset: AssetLoader): Promise<Buffer> {
  let listInstance = 0;
  const runs = (nodes: NoteNode[] | undefined): ParagraphChild[] =>
    (nodes ?? []).flatMap((n): ParagraphChild[] => {
      if (n.type === "hardBreak") return [new TextRun({ text: "", break: 1 })];
      if (n.type === "inlineMath") return [new TextRun({ text: String(n.attrs?.latex ?? ""), font: "Cambria Math", italics: true })];
      if (n.type !== "text") return runs(n.content);
      const m = new Set((n.marks ?? []).map((x) => x.type));
      const run = new TextRun({
        text: n.text ?? "",
        bold: m.has("bold"),
        italics: m.has("italic"),
        underline: m.has("underline") ? {} : undefined,
        strike: m.has("strike"),
        highlight: m.has("highlight") ? "yellow" : undefined,
        font: m.has("code") ? "Consolas" : undefined,
        style: m.has("link") ? "Hyperlink" : undefined,
      });
      const link = n.marks?.find((x) => x.type === "link")?.attrs?.href;
      return typeof link === "string" && /^https?:|^mailto:/.test(link) ? [new ExternalHyperlink({ children: [run], link })] : [run];
    });

  const blocks = async (nodes: NoteNode[] | undefined, ctx: { level: number; list?: { kind: "bullet" | "ordered" | "task"; instance: number } } = { level: 0 }): Promise<(Paragraph | Table)[]> => {
    const out: (Paragraph | Table)[] = [];
    for (const n of nodes ?? []) {
      switch (n.type) {
        case "heading": {
          const lvl = Number(n.attrs?.level ?? 1);
          out.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][lvl - 1], children: runs(n.content), alignment: align(n) }));
          break;
        }
        case "paragraph":
          out.push(
            new Paragraph({
              children: runs(n.content),
              alignment: align(n),
              ...(ctx.list?.kind === "bullet" ? { bullet: { level: ctx.level } } : {}),
              ...(ctx.list?.kind === "ordered" ? { numbering: { reference: "ordered", level: ctx.level, instance: ctx.list.instance } } : {}),
            }),
          );
          break;
        case "bulletList":
        case "orderedList":
        case "taskList": {
          const kind = n.type === "bulletList" ? "bullet" : n.type === "orderedList" ? "ordered" : "task";
          const instance = ++listInstance;
          for (const item of n.content ?? []) {
            const [first, ...rest] = item.content ?? [];
            if (kind === "task") {
              out.push(new Paragraph({ indent: { left: 360 * (ctx.level + 1) }, children: [new TextRun(item.attrs?.checked ? "☑ " : "☐ "), ...runs(first?.content)] }));
            } else if (first) {
              out.push(...(await blocks([first], { level: ctx.level, list: { kind, instance } })));
            }
            out.push(...(await blocks(rest, { level: ctx.level + 1 })));
          }
          break;
        }
        case "blockquote":
          for (const c of n.content ?? [])
            out.push(new Paragraph({ children: runs(c.content), indent: { left: 567 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "B8B2A7", space: 8 } } }));
          break;
        case "codeBlock":
          out.push(new Paragraph({ children: [new TextRun({ text: docToText(n), font: "Consolas" })] }));
          break;
        case "blockMath":
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(n.attrs?.latex ?? ""), font: "Cambria Math", italics: true })] }));
          break;
        case "horizontalRule":
          out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CFC8BC", space: 1 } }, children: [] }));
          break;
        case "image": {
          const a = await loadAsset(assetIdOf(n.attrs?.src));
          const size = a ? imageSize(a.data) : null;
          const type = a?.mimeType === "image/png" ? "png" : a?.mimeType === "image/jpeg" ? "jpg" : a?.mimeType === "image/gif" ? "gif" : null;
          if (a && size && type) out.push(new Paragraph({ children: [new ImageRun({ type, data: a.data, transformation: fit(size, 600) })] }));
          else out.push(new Paragraph({ children: [new TextRun({ text: `[Imagen no exportable${n.attrs?.alt ? `: ${n.attrs.alt}` : ""}]`, italics: true })] }));
          break;
        }
        case "table": {
          const rows = await Promise.all(
            (n.content ?? []).map(
              async (r) =>
                new TableRow({
                  children: await Promise.all(
                    (r.content ?? []).map(async (c) => {
                      const ch = await blocks(c.content);
                      return new TableCell({ children: ch.length ? (ch as Paragraph[]) : [new Paragraph("")], columnSpan: Number(c.attrs?.colspan ?? 1), rowSpan: Number(c.attrs?.rowspan ?? 1) });
                    }),
                  ),
                }),
            ),
          );
          if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
          break;
        }
        default:
          out.push(...(await blocks(n.content, ctx)));
      }
    }
    return out;
  };

  const d = new Document({
    creator: "VANCE",
    title,
    styles: { default: { document: { run: { font: "Georgia", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }), ...(await blocks(doc.content))] }],
  });
  return Packer.toBuffer(d);
}

function align(n: NoteNode) {
  const a = n.attrs?.textAlign;
  return a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : a === "justify" ? AlignmentType.JUSTIFIED : undefined;
}

// ───────────────────────────── PDF ─────────────────────────────

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

export async function exportPdf(doc: NoteNode, title: string, loadAsset: AssetLoader): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "A4", margins: { top: 64, bottom: 64, left: 68, right: 68 }, info: { Title: title, Creator: "VANCE" }, bufferPages: true });
  pdf.registerFont("serif", path.join(FONT_DIR, "LiberationSerif-Regular.ttf"));
  pdf.registerFont("serif-bold", path.join(FONT_DIR, "LiberationSerif-Bold.ttf"));
  pdf.registerFont("serif-italic", path.join(FONT_DIR, "LiberationSerif-Italic.ttf"));
  pdf.registerFont("serif-bolditalic", path.join(FONT_DIR, "LiberationSerif-BoldItalic.ttf"));
  pdf.registerFont("mono", path.join(FONT_DIR, "DejaVuSansMono.ttf"));
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));
  const width = pdf.page.width - 136;
  const INK = "#1c1b19";
  const MUTED = "#6b675f";

  const inline = (nodes: NoteNode[] | undefined, opts: { size: number; indent?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right" | "justify" }) => {
    const parts: { text: string; font: string; underline?: boolean; strike?: boolean; link?: string }[] = [];
    const walk = (list: NoteNode[] | undefined) =>
      (list ?? []).forEach((n) => {
        if (n.type === "hardBreak") parts.push({ text: "\n", font: "serif" });
        else if (n.type === "inlineMath") parts.push({ text: String(n.attrs?.latex ?? ""), font: "mono" });
        else if (n.type === "text") {
          const m = new Set((n.marks ?? []).map((x) => x.type));
          const b = m.has("bold") || opts.bold;
          const i = m.has("italic");
          const font = m.has("code") ? "mono" : b && i ? "serif-bolditalic" : b ? "serif-bold" : i ? "serif-italic" : "serif";
          const link = n.marks?.find((x) => x.type === "link")?.attrs?.href;
          parts.push({ text: n.text ?? "", font, underline: m.has("underline") || !!link, strike: m.has("strike"), link: typeof link === "string" && /^https?:/.test(link) ? link : undefined });
        } else walk(n.content);
      });
    walk(nodes);
    if (!parts.length) {
      pdf.moveDown(0.4);
      return;
    }
    pdf.fillColor(opts.color ?? INK).fontSize(opts.size);
    parts.forEach((p, idx) => {
      pdf.font(p.font).text(p.text, {
        continued: idx < parts.length - 1,
        underline: p.underline,
        strike: p.strike,
        link: p.link,
        indent: idx === 0 ? opts.indent ?? 0 : 0,
        width: width - (opts.indent ?? 0),
        align: opts.align,
        lineGap: 3,
      });
    });
    pdf.moveDown(0.5);
  };

  const block = async (nodes: NoteNode[] | undefined, level = 0): Promise<void> => {
    for (const n of nodes ?? []) {
      const x0 = 68 + level * 18;
      pdf.x = x0;
      switch (n.type) {
        case "heading": {
          const lvl = Number(n.attrs?.level ?? 1);
          pdf.moveDown(0.4);
          inline(n.content, { size: [20, 16, 13.5, 12][lvl - 1] ?? 12, bold: true });
          break;
        }
        case "paragraph":
          inline(n.content, { size: 11.5, align: (n.attrs?.textAlign as "left") ?? undefined });
          break;
        case "bulletList":
        case "orderedList":
        case "taskList":
          for (const [i, item] of (n.content ?? []).entries()) {
            const marker = n.type === "orderedList" ? `${Number(n.attrs?.start ?? 1) + i}. ` : n.type === "taskList" ? (item.attrs?.checked ? "☑ " : "☐ ") : "• ";
            const [first, ...rest] = item.content ?? [];
            pdf.x = x0;
            inline([{ type: "text", text: marker }, ...(first?.content ?? [])], { size: 11.5, indent: 0 });
            await block(rest, level + 1);
          }
          break;
        case "blockquote": {
          const y = pdf.y;
          pdf.x = x0 + 14;
          for (const c of n.content ?? []) inline(c.content, { size: 11.5, color: MUTED });
          pdf.save().moveTo(x0 + 4, y).lineTo(x0 + 4, pdf.y - 6).lineWidth(2).strokeColor("#c9c2b6").stroke().restore();
          break;
        }
        case "codeBlock":
        case "blockMath":
          pdf.font("mono").fontSize(10).fillColor(INK).text(n.type === "blockMath" ? String(n.attrs?.latex ?? "") : docToText(n), { width, align: n.type === "blockMath" ? "center" : "left" });
          pdf.moveDown(0.6);
          break;
        case "horizontalRule":
          pdf.moveDown(0.3).save().moveTo(68, pdf.y).lineTo(68 + width, pdf.y).lineWidth(0.5).strokeColor("#cfc8bc").stroke().restore();
          pdf.moveDown(0.6);
          break;
        case "image": {
          const a = await loadAsset(assetIdOf(n.attrs?.src));
          if (a && (a.mimeType === "image/png" || a.mimeType === "image/jpeg")) {
            pdf.image(a.data, { fit: [width, 320] });
            pdf.moveDown(0.6);
          } else inline([{ type: "text", text: "[Imagen no exportable]" }], { size: 10, color: MUTED });
          break;
        }
        case "table": {
          const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => docToText(c)));
          const cols = Math.max(1, ...rows.map((r) => r.length));
          const cw = width / cols;
          pdf.font("serif").fontSize(10).fillColor(INK);
          for (const [ri, r] of rows.entries()) {
            const h = Math.max(...r.map((t) => pdf.heightOfString(t || " ", { width: cw - 10 }))) + 10;
            if (pdf.y + h > pdf.page.height - 64) pdf.addPage();
            const y = pdf.y;
            r.forEach((t, ci) => {
              pdf.rect(68 + ci * cw, y, cw, h).lineWidth(0.5).strokeColor("#cfc8bc").stroke();
              pdf.font(ri === 0 ? "serif-bold" : "serif").text(t, 68 + ci * cw + 5, y + 5, { width: cw - 10 });
            });
            pdf.x = 68;
            pdf.y = y + h;
          }
          pdf.moveDown(0.8);
          break;
        }
        default:
          await block(n.content, level);
      }
    }
  };

  pdf.font("serif-bold").fontSize(24).fillColor(INK).text(title, { width });
  pdf.moveDown(0.8);
  await block(doc.content);
  // Pie de página con número
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    pdf.font("serif").fontSize(9).fillColor(MUTED).text(`${title} · ${i + 1}/${range.count}`, 68, pdf.page.height - 44, { width, align: "center", lineBreak: false });
  }
  pdf.end();
  return done;
}
