import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { buildExtensions } from "@/components/editor/extensions";
import { findTextRange } from "@/components/editor/text-range";

const schema = getSchema(buildExtensions({ onMathClick: () => {} }));
const doc = PMNode.fromJSON(schema, {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Contracción" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Después el " },
        { type: "text", text: "calcio", marks: [{ type: "bold" }] },
        { type: "text", text: " se une a la   tropomiosina y deja libre la actina." },
      ],
    },
  ],
});

describe("localizar texto para aplicar correcciones", () => {
  it("encuentra una cita aunque atraviese marcas de formato y espacios múltiples", () => {
    const r = findTextRange(doc, "el calcio se une a la tropomiosina");
    expect(r).not.toBeNull();
    expect(doc.textBetween(r!.from, r!.to)).toBe("el calcio se une a la   tropomiosina");
  });
  it("devuelve null si el texto ya no está en la página", () => {
    expect(findTextRange(doc, "el calcio se une a la troponina")).toBeNull();
  });
  it("el esquema del editor coincide con el que acepta el servidor", async () => {
    const { sanitizeDoc } = await import("@/server/notebooks/content");
    expect(() => sanitizeDoc(doc.toJSON())).not.toThrow();
    const names = Object.keys(schema.nodes);
    for (const n of ["paragraph", "heading", "bulletList", "orderedList", "taskList", "taskItem", "table", "tableRow", "tableCell", "tableHeader", "image", "inlineMath", "blockMath", "blockquote", "horizontalRule", "codeBlock", "hardBreak"])
      expect(names).toContain(n);
  });
});
