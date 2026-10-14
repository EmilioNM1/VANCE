"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import katex from "katex";
import { TextSelection } from "@tiptap/pm/state";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Quote,
  Redo2,
  Search,
  Sigma,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
  X,
  ScanSearch,
} from "lucide-react";
import type { NoteDoc } from "@/lib/types";
import { Button, IconButton, clsx } from "../ui";
import { Dialog, Menu } from "../ui-overlays";
import { buildExtensions } from "./extensions";
import { searchKey } from "./search-extension";

export interface NoteEditorHandle {
  editor: Editor;
}

interface Props {
  pageId: string;
  initialContent: NoteDoc;
  onChange: () => void;
  onReady: (editor: Editor) => void;
  onCheckSelection?: (text: string) => void;
  paper: boolean;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

async function uploadImage(file: File, pageId: string): Promise<string> {
  const fd = new FormData();
  fd.set("file", file);
  fd.set("pageId", pageId);
  const res = await fetch("/api/notes/assets", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "No se pudo subir la imagen");
  return data.src as string;
}

export function NoteEditor({ pageId, initialContent, onChange, onReady, onCheckSelection, paper }: Props) {
  const [math, setMath] = useState<null | { kind: "inline" | "block"; latex: string; pos?: number }>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pageRef = useRef(pageId);
  pageRef.current = pageId;

  const insertFiles = useCallback(async (editor: Editor, files: File[], pos?: number) => {
    setUploadError(null);
    for (const f of files.filter((x) => x.type.startsWith("image/"))) {
      try {
        const src = await uploadImage(f, pageRef.current);
        const chain = editor.chain().focus();
        if (pos !== undefined) chain.insertContentAt(pos, { type: "image", attrs: { src, alt: f.name } }).run();
        else chain.setImage({ src, alt: f.name }).run();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Error al subir la imagen");
      }
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: buildExtensions({ onMathClick: (kind, node, pos) => setMath({ kind, latex: String(node.attrs.latex ?? ""), pos }) }),
    content: initialContent,
    editorProps: {
      attributes: {
        class: "focus:outline-none",
        spellcheck: "true",
        lang: "es",
        "aria-label": "Contenido de la página",
        role: "textbox",
        "aria-multiline": "true",
      },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.some((f) => f.type.startsWith("image/")) && editorRef.current) {
          void insertFiles(editorRef.current, files);
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!moved && files.some((f) => f.type.startsWith("image/")) && editorRef.current) {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertFiles(editorRef.current, files, pos);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ transaction }) => {
      // Las decoraciones de búsqueda no cuentan como cambios
      if (transaction.docChanged) onChange();
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);

  // Atajos propios: buscar (Ctrl/Cmd+F) y enlace (Ctrl/Cmd+K)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod || !editor) return;
      const inEditor = editor.view.dom.contains(document.activeElement) || document.activeElement === document.body;
      if (e.key.toLowerCase() === "f" && !e.shiftKey && inEditor) {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key.toLowerCase() === "k" && editor.isFocused) {
        e.preventDefault();
        setLinkOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  if (!editor) return <div className="min-h-[60vh] animate-pulse rounded-xl bg-sunken/60" aria-busy="true" />;

  return (
    <div className="note-editor relative">
      <Toolbar editor={editor} onLink={() => setLinkOpen(true)} onImage={() => fileInput.current?.click()} onMath={(kind) => setMath({ kind, latex: "" })} onFind={() => setFindOpen(true)} />
      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      {uploadError && (
        <p role="alert" className="mx-auto mt-2 max-w-[46rem] rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
          {uploadError}
        </p>
      )}

      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: ed, state }) => !state.selection.empty && ed.isEditable && !ed.isActive("image") && !ed.isActive("inlineMath") && !ed.isActive("blockMath")}
        className="z-40 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-float"
      >
        <IconButton label="Negrita" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </IconButton>
        <IconButton label="Cursiva" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </IconButton>
        <IconButton label="Resaltar" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
          <Highlighter className="h-4 w-4" />
        </IconButton>
        <IconButton label="Enlace" active={editor.isActive("link")} onClick={() => setLinkOpen(true)}>
          <Link2 className="h-4 w-4" />
        </IconButton>
        {onCheckSelection && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            <button
              type="button"
              onClick={() => {
                const { from, to } = editor.state.selection;
                onCheckSelection(editor.state.doc.textBetween(from, to, "\n"));
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-accent-700 hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-900/40"
            >
              <ScanSearch className="h-4 w-4" /> Contrastar con el libro
            </button>
          </>
        )}
      </BubbleMenu>

      <div className={clsx("transition-[padding]", paper ? "px-0 py-6 sm:px-6 lg:py-10" : "py-4")}>
        <div
          className={clsx(
            "mx-auto",
            paper
              ? "max-w-[52rem] rounded-sm bg-surface px-6 py-10 shadow-paper ring-1 ring-line sm:px-[4.5rem] sm:py-16 md:min-h-[calc(100vh-12rem)]"
              : "max-w-[46rem] px-1 sm:px-2",
          )}
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        aria-label="Insertar imagen"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void insertFiles(editor, files);
        }}
      />
      <LinkDialog editor={editor} open={linkOpen} onClose={() => setLinkOpen(false)} />
      <MathDialog editor={editor} value={math} onClose={() => setMath(null)} />
    </div>
  );
}

// ───────────────────────────── Barra de herramientas ─────────────────────────────

function useVisualViewportBottom() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setOffset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return offset;
}

function Toolbar({ editor, onLink, onImage, onMath, onFind }: { editor: Editor; onLink: () => void; onImage: () => void; onMath: (k: "inline" | "block") => void; onFind: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      highlight: e.isActive("highlight"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      h: [1, 2, 3, 4].find((l) => e.isActive("heading", { level: l })) ?? 0,
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const keyboardOffset = useVisualViewportBottom();
  const mod = isMac() ? "⌘" : "Ctrl+";
  const c = () => editor.chain().focus();
  const blockLabel = s.h ? `Título ${s.h}` : s.quote ? "Cita" : "Texto";

  const marks = (
    <>
      <IconButton label={`Negrita (${mod}B)`} active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </IconButton>
      <IconButton label={`Cursiva (${mod}I)`} active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </IconButton>
      <IconButton label={`Subrayado (${mod}U)`} active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline className="h-4 w-4" />
      </IconButton>
      <IconButton label="Tachado" active={s.strike} onClick={() => c().toggleStrike().run()} className="hidden sm:inline-flex">
        <Strikethrough className="h-4 w-4" />
      </IconButton>
      <IconButton label="Resaltar" active={s.highlight} onClick={() => c().toggleHighlight().run()}>
        <Highlighter className="h-4 w-4" />
      </IconButton>
    </>
  );
  const lists = (
    <>
      <IconButton label="Lista con viñetas" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </IconButton>
      <IconButton label="Lista numerada" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </IconButton>
      <IconButton label="Lista de tareas" active={s.task} onClick={() => c().toggleTaskList().run()}>
        <ListChecks className="h-4 w-4" />
      </IconButton>
    </>
  );
  const blockMenu = (
    <Menu
      label="Estilo de párrafo"
      align="left"
      trigger={
        <span className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[13px] font-medium text-text hover:bg-sunken">
          {blockLabel} <ChevronDown className="h-3.5 w-3.5 text-muted" />
        </span>
      }
      items={[
        { label: "Texto", onSelect: () => c().setParagraph().run(), hint: `${mod}⌥0` },
        { label: "Título 1", onSelect: () => c().toggleHeading({ level: 1 }).run(), hint: `${mod}⌥1` },
        { label: "Título 2", onSelect: () => c().toggleHeading({ level: 2 }).run(), hint: `${mod}⌥2` },
        { label: "Título 3", onSelect: () => c().toggleHeading({ level: 3 }).run(), hint: `${mod}⌥3` },
        { label: "Subapartado", onSelect: () => c().toggleHeading({ level: 4 }).run() },
        "separator",
        { label: "Cita", icon: <Quote className="h-4 w-4" />, onSelect: () => c().toggleBlockquote().run() },
        { label: "Código", icon: <Code className="h-4 w-4" />, onSelect: () => c().toggleCodeBlock().run() },
      ]}
    />
  );
  const insertMenu = (
    <Menu
      label="Insertar"
      trigger={
        <span className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-text hover:bg-sunken">
          Insertar <ChevronDown className="h-3.5 w-3.5 text-muted" />
        </span>
      }
      items={[
        { label: "Enlace", icon: <Link2 className="h-4 w-4" />, onSelect: onLink, hint: `${mod}K` },
        { label: "Imagen", icon: <ImagePlus className="h-4 w-4" />, onSelect: onImage },
        { label: "Tabla", icon: <Table2 className="h-4 w-4" />, onSelect: () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
        { label: "Fórmula en línea", icon: <Sigma className="h-4 w-4" />, onSelect: () => onMath("inline") },
        { label: "Fórmula en bloque", icon: <Sigma className="h-4 w-4" />, onSelect: () => onMath("block") },
        { label: "Cita", icon: <Quote className="h-4 w-4" />, onSelect: () => c().toggleBlockquote().run() },
        { label: "Separador", icon: <Minus className="h-4 w-4" />, onSelect: () => c().setHorizontalRule().run() },
      ]}
    />
  );
  const tableMenu = s.table ? (
    <Menu
      label="Tabla"
      trigger={
        <span className="inline-flex h-8 items-center gap-1 rounded-md bg-accent-50 px-2 text-[13px] font-medium text-accent-800 dark:bg-accent-900/40 dark:text-accent-200">
          <Table2 className="h-4 w-4" /> Tabla <ChevronDown className="h-3.5 w-3.5" />
        </span>
      }
      items={[
        { label: "Fila encima", onSelect: () => c().addRowBefore().run() },
        { label: "Fila debajo", onSelect: () => c().addRowAfter().run() },
        { label: "Columna a la izquierda", onSelect: () => c().addColumnBefore().run() },
        { label: "Columna a la derecha", onSelect: () => c().addColumnAfter().run() },
        "separator",
        { label: "Combinar o separar celdas", onSelect: () => c().mergeOrSplit().run() },
        { label: "Fila de encabezado", onSelect: () => c().toggleHeaderRow().run() },
        "separator",
        { label: "Eliminar fila", onSelect: () => c().deleteRow().run(), danger: true },
        { label: "Eliminar columna", onSelect: () => c().deleteColumn().run(), danger: true },
        { label: "Eliminar tabla", onSelect: () => c().deleteTable().run(), danger: true },
      ]}
    />
  ) : null;
  const alignMenu = (
    <Menu
      label="Alineación"
      trigger={
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-text">
          {s.align === "center" ? <AlignCenter className="h-4 w-4" /> : s.align === "right" ? <AlignRight className="h-4 w-4" /> : s.align === "justify" ? <AlignJustify className="h-4 w-4" /> : <AlignLeft className="h-4 w-4" />}
        </span>
      }
      items={[
        { label: "Izquierda", icon: <AlignLeft className="h-4 w-4" />, onSelect: () => c().setTextAlign("left").run() },
        { label: "Centrado", icon: <AlignCenter className="h-4 w-4" />, onSelect: () => c().setTextAlign("center").run() },
        { label: "Derecha", icon: <AlignRight className="h-4 w-4" />, onSelect: () => c().setTextAlign("right").run() },
        { label: "Justificado", icon: <AlignJustify className="h-4 w-4" />, onSelect: () => c().setTextAlign("justify").run() },
      ]}
    />
  );
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />;

  return (
    <>
      {/* Tableta y escritorio: barra superior fija y compacta */}
      <div role="toolbar" aria-label="Formato" className="no-print sticky top-[3.25rem] z-20 hidden items-center justify-center gap-0.5 border-b border-line bg-paper/95 px-2 py-1.5 backdrop-blur md:flex">
        <IconButton label={`Deshacer (${mod}Z)`} disabled={!s.canUndo} onClick={() => c().undo().run()}>
          <Undo2 className="h-4 w-4" />
        </IconButton>
        <IconButton label={`Rehacer (${mod}⇧Z)`} disabled={!s.canRedo} onClick={() => c().redo().run()}>
          <Redo2 className="h-4 w-4" />
        </IconButton>
        {sep}
        {blockMenu}
        {sep}
        {marks}
        <IconButton label="Código en línea" active={s.code} onClick={() => c().toggleCode().run()} className="hidden lg:inline-flex">
          <Code className="h-4 w-4" />
        </IconButton>
        {sep}
        {lists}
        <span className="hidden lg:contents">{alignMenu}</span>
        {sep}
        {insertMenu}
        {tableMenu}
        {sep}
        <IconButton label={`Buscar y reemplazar (${mod}F)`} onClick={onFind}>
          <Search className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Móvil: barra inferior desplazable, siempre sobre el teclado */}
      <div
        role="toolbar"
        aria-label="Formato"
        style={{ bottom: keyboardOffset }}
        className="no-print fixed inset-x-0 z-40 flex items-center gap-0.5 overflow-x-auto border-t border-line bg-surface/95 px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
      >
        <IconButton label="Deshacer" disabled={!s.canUndo} onClick={() => c().undo().run()}>
          <Undo2 className="h-[18px] w-[18px]" />
        </IconButton>
        {blockMenu}
        {marks}
        {lists}
        {tableMenu}
        <Menu
          label="Más opciones"
          trigger={
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted">
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </span>
          }
          items={[
            { label: "Rehacer", icon: <Redo2 className="h-4 w-4" />, onSelect: () => c().redo().run() },
            { label: "Enlace", icon: <Link2 className="h-4 w-4" />, onSelect: onLink },
            { label: "Imagen", icon: <ImagePlus className="h-4 w-4" />, onSelect: onImage },
            { label: "Tabla", icon: <Table2 className="h-4 w-4" />, onSelect: () => c().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() },
            { label: "Fórmula", icon: <Sigma className="h-4 w-4" />, onSelect: () => onMath("inline") },
            { label: "Cita", icon: <Quote className="h-4 w-4" />, onSelect: () => c().toggleBlockquote().run() },
            { label: "Separador", icon: <Minus className="h-4 w-4" />, onSelect: () => c().setHorizontalRule().run() },
            { label: "Buscar en la página", icon: <Search className="h-4 w-4" />, onSelect: onFind },
          ]}
        />
      </div>
    </>
  );
}

// ───────────────────────────── Buscar y reemplazar ─────────────────────────────

function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [replace, setReplace] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const state = useEditorState({ editor, selector: ({ editor: e }) => searchKey.getState(e.state) });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sel = editor.state.selection;
    const selected = sel.empty ? "" : editor.state.doc.textBetween(sel.from, sel.to, " ").slice(0, 100);
    if (selected) setTerm(selected);
    input.current?.focus();
    input.current?.select();
    return () => {
      editor.commands.setSearchTerm("");
    };
  }, [editor]);
  useEffect(() => {
    editor.commands.setSearchTerm(term);
  }, [term, editor]);
  const count = state?.results.length ?? 0;
  return (
    <div role="search" className="no-print sticky top-[6.1rem] z-30 mx-auto mt-2 flex max-w-[46rem] flex-col gap-2 rounded-lg border border-line bg-surface p-2 shadow-float sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-2">
        <Search className="ml-1 h-4 w-4 shrink-0 text-muted" />
        <label htmlFor="find-term" className="sr-only">Buscar en la página</label>
        <input
          id="find-term"
          ref={input}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) editor.commands.previousSearchResult();
              else editor.commands.nextSearchResult();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Buscar en la página"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <span className="shrink-0 text-xs tabular-nums text-muted" aria-live="polite">
          {term ? (count ? `${(state?.current ?? 0) + 1} de ${count}` : "Sin resultados") : ""}
        </span>
        <IconButton label="Anterior (Mayús+Intro)" onClick={() => editor.commands.previousSearchResult()} disabled={!count}>
          <ChevronDown className="h-4 w-4 rotate-180" />
        </IconButton>
        <IconButton label="Siguiente (Intro)" onClick={() => editor.commands.nextSearchResult()} disabled={!count}>
          <ChevronDown className="h-4 w-4" />
        </IconButton>
        <button type="button" onClick={() => setShowReplace((v) => !v)} className="text-xs font-medium text-accent-700 dark:text-accent-300">
          Reemplazar
        </button>
        <IconButton label="Cerrar búsqueda (Esc)" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      {showReplace && (
        <div className="flex items-center gap-2 border-t border-line pt-2 sm:border-l sm:border-t-0 sm:pl-2 sm:pt-0">
          <label htmlFor="find-replace" className="sr-only">Reemplazar por</label>
          <input id="find-replace" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Reemplazar por" className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          <Button size="sm" variant="secondary" disabled={!count} onClick={() => editor.commands.replaceCurrentResult(replace)}>
            Uno
          </Button>
          <Button size="sm" variant="secondary" disabled={!count} onClick={() => editor.commands.replaceAllResults(replace)}>
            Todos
          </Button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Diálogos ─────────────────────────────

function LinkDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (open) setUrl(String(editor.getAttributes("link").href ?? ""));
  }, [open, editor]);
  return (
    <Dialog open={open} onClose={onClose} title="Enlace">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const href = url.trim();
          if (!href) editor.chain().focus().extendMarkRange("link").unsetLink().run();
          else {
            const full = /^(https?:|mailto:|\/app\/)/.test(href) ? href : `https://${href}`;
            if (editor.state.selection.empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href: full } }] }).run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href: full }).run();
          }
          onClose();
        }}
        className="space-y-4"
      >
        <div>
          <label className="label" htmlFor="link-url">Dirección</label>
          <input id="link-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://pubmed.ncbi.nlm.nih.gov/…" inputMode="url" />
        </div>
        <div className="flex justify-end gap-2">
          {editor.isActive("link") && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                onClose();
              }}
            >
              Quitar enlace
            </Button>
          )}
          <Button type="submit">Aplicar</Button>
        </div>
      </form>
    </Dialog>
  );
}

function MathDialog({ editor, value, onClose }: { editor: Editor; value: null | { kind: "inline" | "block"; latex: string; pos?: number }; onClose: () => void }) {
  const [latex, setLatex] = useState("");
  useEffect(() => {
    if (value) setLatex(value.latex);
  }, [value]);
  if (!value) return null;
  let preview = "";
  let error: string | null = null;
  try {
    preview = katex.renderToString(latex || "\\;", { throwOnError: true, displayMode: value.kind === "block" });
  } catch (e) {
    error = e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : "Fórmula no válida";
  }
  const editing = value.pos !== undefined;
  return (
    <Dialog open onClose={onClose} title={editing ? "Editar fórmula" : value.kind === "block" ? "Fórmula en bloque" : "Fórmula en línea"}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const chain = editor.chain().focus();
          if (editing) {
            if (value.kind === "inline") chain.updateInlineMath({ latex, pos: value.pos }).run();
            else chain.updateBlockMath({ latex, pos: value.pos }).run();
          } else if (latex.trim()) {
            if (value.kind === "inline") chain.insertInlineMath({ latex }).run();
            else
              chain
                .insertBlockMath({ latex })
                // Deja el cursor después de la fórmula (si no, lo siguiente que se escriba la sustituiría)
                .command(({ tr }) => {
                  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, tr.selection.to)), 1));
                  return true;
                })
                .run();
          }
          onClose();
        }}
      >
        <div>
          <label className="label" htmlFor="latex">Fórmula (LaTeX)</label>
          <textarea id="latex" className="input min-h-24 font-mono text-[13px]" value={latex} onChange={(e) => setLatex(e.target.value)} placeholder="E = \frac{RT}{zF}\ln\frac{[X]_o}{[X]_i}" spellCheck={false} />
        </div>
        <div className="min-h-14 overflow-x-auto rounded-lg bg-sunken px-3 py-3 text-center" aria-live="polite">
          {error ? <p className="text-sm text-rose-600">{error}</p> : <span dangerouslySetInnerHTML={{ __html: preview }} />}
        </div>
        <div className="flex justify-between gap-2">
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              className="text-rose-600"
              onClick={() => {
                if (value.kind === "inline") editor.chain().focus().deleteInlineMath({ pos: value.pos }).run();
                else editor.chain().focus().deleteBlockMath({ pos: value.pos }).run();
                onClose();
              }}
            >
              Eliminar
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={!!error && !!latex}>
            {editing ? "Guardar" : "Insertar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
