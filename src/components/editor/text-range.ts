import type { Node as PMNode } from "@tiptap/pm/model";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Localiza un texto literal dentro del documento y devuelve sus posiciones ProseMirror.
 * Busca bloque a bloque (párrafos, títulos, celdas) tolerando diferencias de espacios.
 */
export function findTextRange(doc: PMNode, needle: string): { from: number; to: number } | null {
  const target = norm(needle);
  if (!target) return null;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    // Mapa carácter → posición del documento (los nodos en línea no textuales ocupan 1)
    const chars: string[] = [];
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          chars.push(child.text[i]!);
          positions.push(pos + 1 + offset + i);
        }
      } else {
        chars.push(" ");
        positions.push(pos + 1 + offset);
      }
    });
    // Normaliza espacios conservando el mapeo
    let text = "";
    const map: number[] = [];
    for (let i = 0; i < chars.length; i++) {
      const c = /\s/.test(chars[i]!) ? " " : chars[i]!;
      if (c === " " && text.endsWith(" ")) continue;
      text += c;
      map.push(positions[i]!);
    }
    const idx = text.indexOf(target);
    if (idx >= 0) {
      found = { from: map[idx]!, to: map[idx + target.length - 1]! + 1 };
      return false;
    }
    return false;
  });
  return found;
}
