import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Buscar y reemplazar dentro de la página (como Ctrl+F en un procesador de texto).
 * Resalta todas las coincidencias y permite recorrerlas y sustituirlas.
 */
export interface SearchState {
  term: string;
  caseSensitive: boolean;
  results: { from: number; to: number }[];
  current: number;
}

export const searchKey = new PluginKey<SearchState>("vance-search");

function find(doc: EditorState["doc"], term: string, caseSensitive: boolean) {
  const results: { from: number; to: number }[] = [];
  if (!term) return results;
  const needle = caseSensitive ? term : term.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = caseSensitive ? node.text : node.text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) {
      results.push({ from: pos + i, to: pos + i + needle.length });
      i = hay.indexOf(needle, i + needle.length);
    }
  });
  return results;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchTerm: (term: string, caseSensitive?: boolean) => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      replaceCurrentResult: (text: string) => ReturnType;
      replaceAllResults: (text: string) => ReturnType;
    };
  }
}

const withMeta = (tr: Transaction, meta: Partial<SearchState>) => tr.setMeta(searchKey, meta);

function scrollToCurrent(state: EditorState, tr: Transaction, s: SearchState) {
  const r = s.results[s.current];
  if (!r) return;
  tr.setMeta("scrollIntoView", true);
  void state;
}

export const SearchExtension = Extension.create({
  name: "search",
  addCommands() {
    return {
      setSearchTerm:
        (term, caseSensitive = false) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(withMeta(tr, { term, caseSensitive, current: 0 }));
          return true;
        },
      nextSearchResult:
        () =>
        ({ state, tr, dispatch, view }) => {
          const s = searchKey.getState(state);
          if (!s?.results.length) return false;
          const current = (s.current + 1) % s.results.length;
          if (dispatch) {
            dispatch(withMeta(tr, { current }));
            scrollToCurrent(state, tr, s);
            const r = s.results[current]!;
            view.domAtPos(r.from).node.parentElement?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          }
          return true;
        },
      previousSearchResult:
        () =>
        ({ state, tr, dispatch, view }) => {
          const s = searchKey.getState(state);
          if (!s?.results.length) return false;
          const current = (s.current - 1 + s.results.length) % s.results.length;
          if (dispatch) {
            dispatch(withMeta(tr, { current }));
            const r = s.results[current]!;
            view.domAtPos(r.from).node.parentElement?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          }
          return true;
        },
      replaceCurrentResult:
        (text) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          const r = s?.results[s.current];
          if (!r) return false;
          if (dispatch) dispatch(text ? tr.insertText(text, r.from, r.to) : tr.delete(r.from, r.to));
          return true;
        },
      replaceAllResults:
        (text) =>
        ({ state, tr, dispatch }) => {
          const s = searchKey.getState(state);
          if (!s?.results.length) return false;
          if (dispatch) {
            // De atrás hacia delante para no desplazar las posiciones
            for (const r of [...s.results].reverse()) {
              if (text) tr.insertText(text, r.from, r.to);
              else tr.delete(r.from, r.to);
            }
            dispatch(tr);
          }
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ term: "", caseSensitive: false, results: [], current: 0 }),
          apply(tr, prev, _old, newState) {
            const meta = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const next = { ...prev, ...(meta ?? {}) };
            if (meta?.term !== undefined || meta?.caseSensitive !== undefined || tr.docChanged) {
              next.results = find(newState.doc, next.term, next.caseSensitive);
              if (next.current >= next.results.length) next.current = 0;
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s?.results.length) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              s.results.map((r, i) => Decoration.inline(r.from, r.to, { class: i === s.current ? "search-hit-current" : "search-hit" })),
            );
          },
        },
      }),
    ];
  },
});
