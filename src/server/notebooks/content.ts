/**
 * Validación y transformación del contenido del editor (documento ProseMirror/Tiptap en JSON).
 * El servidor nunca confía en el cliente: solo se aceptan nodos, marcas y atributos conocidos.
 */
import { createHash } from "node:crypto";
import type { NoteDoc, NoteNode } from "@/lib/types";

export class ContentValidationError extends Error {}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 40;
const MAX_NODES = 60_000;

const NODE_ATTRS: Record<string, string[]> = {
  doc: [],
  paragraph: ["textAlign"],
  text: [],
  heading: ["level", "textAlign"],
  bulletList: [],
  orderedList: ["start", "type"],
  listItem: [],
  taskList: [],
  taskItem: ["checked"],
  blockquote: [],
  horizontalRule: [],
  hardBreak: [],
  codeBlock: ["language"],
  image: ["src", "alt", "title", "width"],
  table: [],
  tableRow: [],
  tableHeader: ["colspan", "rowspan", "colwidth"],
  tableCell: ["colspan", "rowspan", "colwidth"],
  inlineMath: ["latex"],
  blockMath: ["latex"],
};
const MARK_ATTRS: Record<string, string[]> = {
  bold: [],
  italic: [],
  underline: [],
  strike: [],
  code: [],
  highlight: ["color"],
  link: ["href", "target", "rel"],
  subscript: [],
  superscript: [],
};

const ASSET_SRC = /^\/api\/notes\/assets\/[0-9a-f-]{36}$/i;

function safeHref(h: unknown): string | null {
  if (typeof h !== "string" || h.length > 2000) return null;
  if (h.startsWith("/app/") || h.startsWith("#")) return h;
  try {
    const u = new URL(h);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? h : null;
  } catch {
    return null;
  }
}

function cleanAttrs(type: string, attrs: Record<string, unknown> | undefined, allowed: string[]) {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    const v = attrs[k];
    if (v === undefined || v === null) continue;
    switch (k) {
      case "level":
        out[k] = Math.min(4, Math.max(1, Number(v) || 1));
        break;
      case "start":
      case "colspan":
      case "rowspan":
        out[k] = Math.min(1000, Math.max(1, Number(v) || 1));
        break;
      case "checked":
        out[k] = v === true;
        break;
      case "colwidth":
        if (Array.isArray(v)) out[k] = v.slice(0, 50).map((x) => Math.min(2000, Math.max(0, Number(x) || 0)));
        break;
      case "textAlign":
        if (["left", "center", "right", "justify"].includes(String(v))) out[k] = v;
        break;
      case "src":
        if (type === "image" && typeof v === "string" && ASSET_SRC.test(v)) out[k] = v;
        else throw new ContentValidationError("Imagen con origen no permitido.");
        break;
      case "href": {
        const h = safeHref(v);
        if (h) out[k] = h;
        break;
      }
      case "target":
        if (v === "_blank") out[k] = v;
        break;
      case "rel":
        out[k] = "noopener noreferrer nofollow";
        break;
      case "width":
        if (Number(v) > 0) out[k] = Math.min(2000, Number(v));
        break;
      default:
        if (typeof v === "string") out[k] = v.slice(0, k === "latex" ? 5000 : 500);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Valida y limpia un documento. Lanza ContentValidationError si no es aceptable. */
export function sanitizeDoc(input: unknown): NoteDoc {
  const raw = JSON.stringify(input ?? null);
  if (!raw || raw.length > MAX_BYTES) throw new ContentValidationError("La página es demasiado grande (máx. 2 MB de contenido).");
  let count = 0;
  const walk = (n: unknown, depth: number): NoteNode => {
    if (depth > MAX_DEPTH) throw new ContentValidationError("Estructura demasiado anidada.");
    if (++count > MAX_NODES) throw new ContentValidationError("La página tiene demasiados elementos.");
    if (!n || typeof n !== "object") throw new ContentValidationError("Nodo no válido.");
    const node = n as NoteNode;
    if (typeof node.type !== "string" || !(node.type in NODE_ATTRS)) throw new ContentValidationError(`Elemento no permitido: ${String(node.type)}`);
    const out: NoteNode = { type: node.type };
    const attrs = cleanAttrs(node.type, node.attrs, NODE_ATTRS[node.type]!);
    if (attrs) out.attrs = attrs;
    if (node.type === "text") {
      if (typeof node.text !== "string" || !node.text) throw new ContentValidationError("Texto vacío no válido.");
      out.text = node.text;
      if (Array.isArray(node.marks) && node.marks.length) {
        out.marks = node.marks
          .filter((m) => m && typeof m.type === "string" && m.type in MARK_ATTRS)
          .map((m) => {
            const a = cleanAttrs(m.type, m.attrs, MARK_ATTRS[m.type]!);
            return a ? { type: m.type, attrs: a } : { type: m.type };
          })
          .filter((m) => m.type !== "link" || m.attrs?.href);
      }
      return out;
    }
    if (Array.isArray(node.content)) out.content = node.content.map((c) => walk(c, depth + 1));
    return out;
  };
  const doc = walk(input, 0);
  if (doc.type !== "doc") throw new ContentValidationError("El contenido debe ser un documento.");
  return doc as NoteDoc;
}

// ───────────────────────────── Conversión a texto y Markdown ─────────────────────────────

const BLOCKS = new Set(["paragraph", "heading", "blockquote", "listItem", "taskItem", "codeBlock", "tableRow", "blockMath", "horizontalRule", "image"]);

/** Texto plano (búsqueda, análisis con IA, exportación TXT). */
export function docToText(doc: NoteNode): string {
  const out: string[] = [];
  const walk = (n: NoteNode, prefix = "") => {
    switch (n.type) {
      case "text":
        out.push(n.text ?? "");
        return;
      case "hardBreak":
        out.push("\n");
        return;
      case "inlineMath":
        out.push(`$${String(n.attrs?.latex ?? "")}$`);
        return;
      case "blockMath":
        out.push(`\n$$${String(n.attrs?.latex ?? "")}$$\n`);
        return;
      case "horizontalRule":
        out.push("\n———\n");
        return;
      case "image":
        out.push(`\n[Imagen${n.attrs?.alt ? `: ${n.attrs.alt}` : ""}]\n`);
        return;
      case "tableCell":
      case "tableHeader":
        (n.content ?? []).forEach((c) => walk(c));
        out.push(" | ");
        return;
      case "taskItem":
        out.push(`${prefix}[${n.attrs?.checked ? "x" : " "}] `);
        break;
      case "listItem":
        out.push(prefix || "• ");
        break;
    }
    (n.content ?? []).forEach((c, i) => walk(c, n.type === "orderedList" ? `${Number(n.attrs?.start ?? 1) + i}. ` : ""));
    if (BLOCKS.has(n.type)) out.push("\n");
  };
  walk(doc);
  return out
    .join("")
    .replace(/ \| \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mdInline(nodes: NoteNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "inlineMath") return `$${String(n.attrs?.latex ?? "")}$`;
      if (n.type !== "text") return mdInline(n.content);
      let t = (n.text ?? "").replace(/([*_`~\\[\]])/g, "\\$1");
      for (const m of n.marks ?? []) {
        if (m.type === "bold") t = `**${t}**`;
        else if (m.type === "italic") t = `*${t}*`;
        else if (m.type === "strike") t = `~~${t}~~`;
        else if (m.type === "code") t = `\`${n.text}\``;
        else if (m.type === "underline") t = `<u>${t}</u>`;
        else if (m.type === "highlight") t = `==${t}==`;
        else if (m.type === "link") t = `[${t}](${String(m.attrs?.href ?? "")})`;
      }
      return t;
    })
    .join("");
}

export function docToMarkdown(doc: NoteNode, title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`, "");
  const block = (n: NoteNode, indent = ""): void => {
    switch (n.type) {
      case "heading":
        lines.push(`${"#".repeat(Math.min(6, Number(n.attrs?.level ?? 1) + (title ? 1 : 0)))} ${mdInline(n.content)}`, "");
        return;
      case "paragraph":
        lines.push(indent + mdInline(n.content));
        if (!indent) lines.push("");
        return;
      case "blockquote":
        (n.content ?? []).forEach((c) => {
          const start = lines.length;
          block(c);
          for (let i = start; i < lines.length; i++) lines[i] = `> ${lines[i]}`;
        });
        lines.push("");
        return;
      case "bulletList":
      case "orderedList":
      case "taskList":
        (n.content ?? []).forEach((item, i) => {
          const marker =
            n.type === "orderedList" ? `${Number(n.attrs?.start ?? 1) + i}. ` : n.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] ` : "- ";
          const [first, ...rest] = item.content ?? [];
          lines.push(indent + marker + (first ? mdInline(first.content) : ""));
          rest.forEach((r) => block(r, indent + "  "));
        });
        if (!indent) lines.push("");
        return;
      case "codeBlock":
        lines.push("```" + String(n.attrs?.language ?? ""), docToText(n), "```", "");
        return;
      case "horizontalRule":
        lines.push("---", "");
        return;
      case "blockMath":
        lines.push("$$", String(n.attrs?.latex ?? ""), "$$", "");
        return;
      case "image":
        lines.push(`![${String(n.attrs?.alt ?? "imagen")}](${String(n.attrs?.src ?? "")})`, "");
        return;
      case "table": {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => mdInline(p.content)).join(" ").replace(/\|/g, "\\|")));
        if (!rows.length) return;
        const cols = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill("")];
        lines.push(`| ${pad(rows[0]!).join(" | ")} |`, `| ${Array(cols).fill("---").join(" | ")} |`);
        rows.slice(1).forEach((r) => lines.push(`| ${pad(r).join(" | ")} |`));
        lines.push("");
        return;
      }
      default:
        (n.content ?? []).forEach((c) => block(c, indent));
    }
  };
  (doc.content ?? []).forEach((n) => block(n));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function contentHash(text: string) {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

export function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Imágenes referenciadas por el documento (para exportación y limpieza). */
export function assetIds(doc: NoteNode): string[] {
  const ids: string[] = [];
  const walk = (n: NoteNode) => {
    if (n.type === "image" && typeof n.attrs?.src === "string") ids.push(n.attrs.src.split("/").pop()!);
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return ids;
}
