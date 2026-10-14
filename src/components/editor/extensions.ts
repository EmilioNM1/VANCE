import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import { Mathematics } from "@tiptap/extension-mathematics";
import type { Node as PMNode } from "@tiptap/pm/model";
import { SearchExtension } from "./search-extension";

export function buildExtensions(opts: { onMathClick: (kind: "inline" | "block", node: PMNode, pos: number) => void }) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: false, allowBase64: false }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? "Título" : "Escribe tus apuntes…"),
    }),
    CharacterCount,
    Highlight.configure({ multicolor: false }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Typography,
    Mathematics.configure({
      inlineOptions: { onClick: (node, pos) => opts.onMathClick("inline", node, pos) },
      blockOptions: { onClick: (node, pos) => opts.onMathClick("block", node, pos) },
      katexOptions: { throwOnError: false },
    }),
    SearchExtension,
  ];
}
