"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { generateHTML } from "@tiptap/core";
import { BookOpen, Brain, ChevronLeft, Copy, Download, FileText, History, Maximize2, MoreHorizontal, PanelLeft, ScanSearch, Trash2, X } from "lucide-react";
import type { NoteDoc } from "@/lib/types";
import { api } from "@/lib/api";
import { NOTEBOOK_DOT } from "@/lib/labels";
import { Button, IconButton, Spinner, clsx, relativeTime } from "../ui";
import { Dialog, Menu } from "../ui-overlays";
import { NoteEditor } from "../editor/note-editor";
import { backupKey, useAutosave, type SaveStatus, type ServerPage } from "../editor/use-autosave";
import { buildExtensions } from "../editor/extensions";
import { NotebookTree, type TreeNotebook, type TreeSection } from "./notebook-tree";
import { ReferencePanel, ReviewPanel, StudyPanel, type LinkedDoc } from "./panels";

export interface WorkspaceProps {
  page: { id: string; title: string; content: NoteDoc; version: number; contentHash: string; lastAnalyzedHash: string | null; wordCount: number; updatedAt: string };
  notebook: TreeNotebook;
  section: { id: string; title: string };
  tree: TreeSection[];
  linkedDocuments: LinkedDoc[];
  allDocuments: { id: string; title: string }[];
  conceptCount: number;
  aiEnabled: boolean;
  geminiEnabled: boolean;
}

type Panel = "book" | "review" | "study" | null;

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Guardado",
  dirty: "Cambios sin guardar",
  saving: "Guardando…",
  offline: "Sin conexión · se guardará al reconectar",
  error: "No se pudo guardar · reintentando",
  conflict: "Conflicto con otro dispositivo",
};

export function NoteWorkspace(props: WorkspaceProps) {
  const router = useRouter();
  const { page } = props;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [title, setTitle] = useState(page.title);
  const titleRef = useRef(page.title);
  const [paper, setPaper] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [desktopTree, setDesktopTree] = useState(true);
  const [conflict, setConflict] = useState<ServerPage | null>(null);
  const [backup, setBackup] = useState<null | { content: NoteDoc; title: string; at: number }>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectionRequest, setSelectionRequest] = useState<string | null>(null);
  const [hash, setHash] = useState({ content: page.contentHash, analyzed: page.lastAnalyzedHash, words: page.wordCount });
  const [notice, setNotice] = useState<string | null>(null);

  // Preferencias de vista (por dispositivo)
  useEffect(() => {
    try {
      const v = localStorage.getItem("vance-editor-view");
      if (v) setPaper(v === "paper");
      else setPaper(window.innerWidth >= 1024);
      setDesktopTree(localStorage.getItem("vance-editor-tree") !== "closed");
    } catch {
      /* ignorar */
    }
  }, []);

  const autosave = useAutosave({
    pageId: page.id,
    initialVersion: page.version,
    getSnapshot: () => ({ content: (editor?.getJSON() as NoteDoc) ?? page.content, title: titleRef.current.trim() || "Sin título" }),
    onConflict: (server) => setConflict(server),
    onSaved: (r) => setHash({ content: r.contentHash, analyzed: r.lastAnalyzedHash, words: r.wordCount }),
  });
  const { status, lastSavedAt, markDirty, saveNow, setVersion, resolveConflict, versionRef } = autosave;

  // Copia local sin confirmar (cierre inesperado, sin conexión)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(backupKey(page.id));
      if (!raw) return;
      const b = JSON.parse(raw) as { baseVersion: number; content: NoteDoc; title: string; at: number };
      if (JSON.stringify(b.content) !== JSON.stringify(page.content) || b.title !== page.title) setBackup(b);
      else localStorage.removeItem(backupKey(page.id));
    } catch {
      /* ignorar */
    }
  }, [page.id, page.content, page.title]);

  // Al volver a la pestaña: si otro dispositivo guardó y aquí no hay cambios, se actualiza
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible" || status !== "saved" || !editor) return;
      try {
        const r = await api<{ page: { version: number; content: NoteDoc; title: string } }>(`/api/notes/pages/${page.id}`);
        if (r.page.version > versionRef.current) {
          editor.commands.setContent(r.page.content, { emitUpdate: false });
          setTitle(r.page.title);
          titleRef.current = r.page.title;
          setVersion(r.page.version);
          setNotice("Página actualizada con los cambios de otro dispositivo.");
        }
      } catch {
        /* sin conexión: se reintentará */
      }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [editor, page.id, status, setVersion, versionRef]);


  const onReady = useCallback((e: Editor) => setEditor(e), []);
  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const flushSave = useCallback(async () => (status === "saved" ? true : saveNow()), [status, saveNow]);
  const stale = hash.content !== hash.analyzed && hash.words >= 40;
  // El título que se está escribiendo se refleja al instante en el explorador
  const liveTree = props.tree.map((sec) => ({ ...sec, pages: sec.pages.map((p) => (p.id === page.id ? { ...p, title: title.trim() || "Sin título" } : p)) }));

  const exportAs = async (format: string) => {
    await flushSave();
    try {
      const res = await fetch(`/api/notes/pages/${page.id}/export?format=${format}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "No se pudo exportar");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      // Nombre sin tildes: algunos navegadores descartan nombres no ASCII y guardan «download»
      const base = (titleRef.current.trim() || "apuntes").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]+/g, "").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80);
      a.download = `${base || "apuntes"}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo exportar");
    }
  };

  const panelTitle = { book: "Libro", review: "Revisión", study: "Estudiar" };
  const panelContent =
    panel === "book" ? (
      <ReferencePanel pageId={page.id} editor={editor} linked={props.linkedDocuments} allDocuments={props.allDocuments} geminiEnabled={props.geminiEnabled} onLinksChanged={() => router.refresh()} />
    ) : panel === "review" ? (
      <ReviewPanel pageId={page.id} editor={editor} aiEnabled={props.aiEnabled} stale={stale} selectionRequest={selectionRequest} onSelectionHandled={() => setSelectionRequest(null)} flushSave={flushSave} />
    ) : panel === "study" ? (
      <StudyPanel pageId={page.id} sectionId={props.section.id} aiEnabled={props.aiEnabled} conceptCount={props.conceptCount} flushSave={flushSave} onBuilt={() => router.refresh()} />
    ) : null;

  return (
    <div className="flex min-h-screen">
      {/* Explorador del cuaderno — escritorio */}
      {desktopTree && (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-paper pt-3 xl:block" aria-label="Explorador del cuaderno">
          <NotebookTree notebook={props.notebook} sections={liveTree} currentPageId={page.id} />
        </aside>
      )}
      {/* Explorador — tableta y móvil (cajón) */}
      {treeOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 bg-ink-950/30" onClick={() => setTreeOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[85%] max-w-xs animate-fade-in border-r border-line bg-paper pt-[max(0.75rem,env(safe-area-inset-top))]" aria-label="Explorador del cuaderno">
            <div className="flex justify-end px-2">
              <IconButton label="Cerrar explorador" onClick={() => setTreeOpen(false)}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <NotebookTree notebook={props.notebook} sections={liveTree} currentPageId={page.id} onNavigate={() => setTreeOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          {/* Cabecera: ruta, estado de guardado y acciones */}
          <header className="no-print sticky top-0 z-30 flex h-[3.25rem] items-center gap-1 border-b border-line bg-paper/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-3">
            <Link href={`/app/notebooks/${props.notebook.id}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-sunken md:hidden" aria-label="Volver al cuaderno">
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <IconButton label="Explorador del cuaderno" onClick={() => setTreeOpen(true)} className="xl:hidden">
              <PanelLeft className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton
              label={desktopTree ? "Ocultar explorador" : "Mostrar explorador"}
              onClick={() => {
                setDesktopTree((v) => {
                  try {
                    localStorage.setItem("vance-editor-tree", v ? "closed" : "open");
                  } catch {
                    /* ignorar */
                  }
                  return !v;
                });
              }}
              className="hidden xl:inline-flex"
            >
              <PanelLeft className="h-[18px] w-[18px]" />
            </IconButton>
            <nav aria-label="Ruta" className="hidden min-w-0 items-center gap-1.5 text-[13px] text-muted sm:flex">
              <span className={clsx("h-2 w-2 shrink-0 rounded-full", NOTEBOOK_DOT[props.notebook.color] ?? NOTEBOOK_DOT.teal)} />
              <Link href={`/app/notebooks/${props.notebook.id}`} className="truncate hover:text-text">
                {props.notebook.title}
              </Link>
              <span aria-hidden>›</span>
              <span className="truncate">{props.section.title}</span>
              <span aria-hidden>›</span>
              <span className="truncate text-text">{title || "Sin título"}</span>
            </nav>
            <div className="ml-auto flex items-center gap-0.5">
              <span
                className={clsx(
                  "mr-1 hidden items-center gap-1.5 text-xs sm:inline-flex",
                  status === "saved" ? "text-muted" : status === "conflict" || status === "error" ? "text-rose-600" : status === "offline" ? "text-amber-600" : "text-muted",
                )}
                role="status"
                aria-live="polite"
                title={lastSavedAt ? `Último guardado: ${lastSavedAt.toLocaleTimeString("es-ES")}` : undefined}
              >
                {status === "saving" && <Spinner className="h-3 w-3" />}
                <span className={clsx("h-1.5 w-1.5 rounded-full", status === "saved" ? "bg-emerald-500" : status === "saving" || status === "dirty" ? "bg-amber-400" : "bg-rose-500")} />
                {STATUS_TEXT[status]}
              </span>
              <span className={clsx("mr-1 h-2 w-2 rounded-full sm:hidden", status === "saved" ? "bg-emerald-500" : status === "saving" || status === "dirty" ? "bg-amber-400" : "bg-rose-500")} role="status" aria-label={STATUS_TEXT[status]} />
              <IconButton label="Libro de referencia" active={panel === "book"} onClick={() => togglePanel("book")}>
                <BookOpen className="h-[18px] w-[18px]" />
              </IconButton>
              <IconButton label="Revisión con el libro" active={panel === "review"} onClick={() => togglePanel("review")}>
                <ScanSearch className="h-[18px] w-[18px]" />
                {stale && props.aiEnabled && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="contenido nuevo sin revisar" />}
              </IconButton>
              <IconButton label="Estudiar esta página" active={panel === "study"} onClick={() => togglePanel("study")}>
                <Brain className="h-[18px] w-[18px]" />
              </IconButton>
              <Menu
                label="Más acciones"
                trigger={
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-sunken">
                    <MoreHorizontal className="h-[18px] w-[18px]" />
                  </span>
                }
                items={[
                  { label: paper ? "Vista continua" : "Vista de hoja", icon: <Maximize2 className="h-4 w-4" />, onSelect: () => setPaper((p) => (localStorage.setItem("vance-editor-view", p ? "flow" : "paper"), !p)) },
                  { label: "Historial de versiones", icon: <History className="h-4 w-4" />, onSelect: () => setVersionsOpen(true) },
                  "separator",
                  { label: "Exportar a Word (.docx)", icon: <Download className="h-4 w-4" />, onSelect: () => exportAs("docx") },
                  { label: "Exportar a PDF", icon: <Download className="h-4 w-4" />, onSelect: () => exportAs("pdf") },
                  { label: "Exportar a Markdown", icon: <Download className="h-4 w-4" />, onSelect: () => exportAs("md") },
                  { label: "Exportar a texto", icon: <FileText className="h-4 w-4" />, onSelect: () => exportAs("txt") },
                  "separator",
                  {
                    label: "Duplicar página",
                    icon: <Copy className="h-4 w-4" />,
                    onSelect: async () => {
                      await flushSave();
                      const r = await api<{ page: { id: string } }>(`/api/notes/pages/${page.id}/duplicate`, { method: "POST" });
                      router.push(`/app/notebooks/page/${r.page.id}`);
                      router.refresh();
                    },
                  },
                  {
                    label: "Eliminar página",
                    icon: <Trash2 className="h-4 w-4" />,
                    danger: true,
                    onSelect: async () => {
                      if (!confirm("¿Eliminar esta página? Se eliminarán también sus preguntas de repaso.")) return;
                      await api(`/api/notes/pages/${page.id}`, { method: "DELETE" });
                      try {
                        localStorage.removeItem(backupKey(page.id));
                      } catch {
                        /* ignorar */
                      }
                      router.push(`/app/notebooks/${props.notebook.id}`);
                      router.refresh();
                    },
                  },
                ]}
              />
            </div>
          </header>

          {backup && (
            <div className="mx-auto mt-3 flex max-w-[46rem] flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
              <span className="flex-1">Hay cambios de esta página que no llegaron a guardarse en este dispositivo ({relativeTime(new Date(backup.at))}).</span>
              <Button
                size="sm"
                onClick={() => {
                  editor?.commands.setContent(backup.content);
                  setTitle(backup.title);
                  titleRef.current = backup.title;
                  setBackup(null);
                  markDirty();
                }}
              >
                Recuperar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  localStorage.removeItem(backupKey(page.id));
                  setBackup(null);
                }}
              >
                Descartar
              </Button>
            </div>
          )}
          {notice && (
            <p className="mx-auto mt-3 max-w-[46rem] rounded-lg bg-sunken px-4 py-2 text-sm" role="status">
              {notice}{" "}
              <button className="underline" onClick={() => setNotice(null)}>
                Cerrar
              </button>
            </p>
          )}

          <div className="pb-32 md:pb-24">
            <div className={clsx("mx-auto px-4 pt-8 sm:px-6", paper ? "max-w-[52rem] lg:px-[4.5rem]" : "max-w-[46rem]")}>
              <label htmlFor="page-title" className="sr-only">Título de la página</label>
              <textarea
                id="page-title"
                rows={1}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  titleRef.current = e.target.value;
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                  markDirty();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    editor?.commands.focus("start");
                  }
                }}
                maxLength={200}
                placeholder="Sin título"
                className="w-full resize-none overflow-hidden bg-transparent font-serif text-[2rem] font-semibold leading-tight tracking-tight text-text outline-none placeholder:text-muted/50 sm:text-[2.4rem]"
              />
            </div>
            <NoteEditor
              pageId={page.id}
              initialContent={page.content}
              onChange={markDirty}
              onReady={onReady}
              paper={paper}
              onCheckSelection={(text) => {
                setPanel("review");
                setSelectionRequest(text);
              }}
            />
            <footer className="no-print mx-auto mt-6 flex max-w-[46rem] flex-wrap items-center gap-x-4 gap-y-1 px-4 text-xs text-muted">
              <span>{editor ? `${editor.storage.characterCount.words()} palabras` : ""}</span>
              {lastSavedAt && <span>Guardado {relativeTime(lastSavedAt)}</span>}
              {stale && props.aiEnabled && (
                <button type="button" onClick={() => setPanel("review")} className="text-accent-700 hover:underline dark:text-accent-300">
                  Contenido nuevo sin revisar · Analizar apuntes
                </button>
              )}
            </footer>
          </div>
        </div>

        {/* Panel lateral: aside en pantallas grandes (consultar mientras se escribe), hoja en el resto */}
        {panel && (
          <>
            <aside className="sticky top-0 hidden h-screen w-[340px] shrink-0 overflow-y-auto border-l border-line bg-paper md:block lg:w-[380px]" aria-label={panelTitle[panel]}>
              <PanelHeader title={panelTitle[panel]} onClose={() => setPanel(null)} />
              <div className="px-4 pb-10">{panelContent}</div>
            </aside>
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-ink-950/25" onClick={() => setPanel(null)} />
              <aside className="absolute inset-x-0 bottom-0 max-h-[88vh] animate-slide-up overflow-y-auto rounded-t-2xl border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]" aria-label={panelTitle[panel]}>
                <PanelHeader title={panelTitle[panel]} onClose={() => setPanel(null)} />
                <div className="px-4 pb-10">{panelContent}</div>
              </aside>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!conflict} onClose={() => {}} title="Esta página cambió en otro dispositivo">
        <p className="text-sm leading-relaxed text-text/85">
          Mientras escribías, esta página se guardó desde otro dispositivo ({conflict ? relativeTime(conflict.updatedAt) : ""}). Elige qué versión conservar. La que descartes quedará en el historial de versiones si sobrescribes.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              if (!conflict) return;
              editor?.commands.setContent(conflict.content, { emitUpdate: false });
              setTitle(conflict.title);
              titleRef.current = conflict.title;
              resolveConflict("theirs", conflict);
              setConflict(null);
            }}
          >
            Usar la del otro dispositivo
          </Button>
          <Button
            onClick={() => {
              resolveConflict("mine");
              setConflict(null);
            }}
          >
            Mantener la mía
          </Button>
        </div>
      </Dialog>
      <VersionsDialog
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        pageId={page.id}
        onRestored={async () => {
          const r = await api<{ page: { version: number; content: NoteDoc; title: string } }>(`/api/notes/pages/${page.id}`);
          editor?.commands.setContent(r.page.content, { emitUpdate: false });
          setTitle(r.page.title);
          titleRef.current = r.page.title;
          setVersion(r.page.version);
          setVersionsOpen(false);
          setNotice("Versión restaurada. La versión anterior se guardó en el historial.");
        }}
        beforeRestore={flushSave}
      />
    </div>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex h-[3.25rem] items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur">
      <h2 className="title-serif text-lg">{title}</h2>
      <IconButton label="Cerrar panel" onClick={onClose}>
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

const REASON: Record<string, string> = { AUTO: "Guardado automático", BEFORE_CORRECTION: "Antes de aplicar una corrección", BEFORE_RESTORE: "Antes de restaurar", MANUAL: "Manual" };

function VersionsDialog({ open, onClose, pageId, onRestored, beforeRestore }: { open: boolean; onClose: () => void; pageId: string; onRestored: () => void; beforeRestore: () => Promise<boolean> }) {
  const [versions, setVersions] = useState<{ id: string; version: number; title: string; reason: string; createdAt: string }[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; html: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    void api<{ versions: typeof versions }>(`/api/notes/pages/${pageId}/versions`).then((r) => setVersions(r.versions));
  }, [open, pageId]);
  return (
    <Dialog open={open} onClose={onClose} title="Historial de versiones" wide>
      {!versions ? (
        <Spinner />
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted">Aún no hay versiones anteriores. Se guardan automáticamente cada pocos minutos de escritura y antes de aplicar correcciones.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={async () => {
                    const r = await api<{ version: { content: NoteDoc } }>(`/api/notes/versions/${v.id}`);
                    setPreview({ id: v.id, html: generateHTML(r.version.content, buildExtensions({ onMathClick: () => {} })) });
                  }}
                  className={clsx("w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sunken", preview?.id === v.id && "bg-sunken")}
                >
                  <span className="block font-medium">{new Date(v.createdAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="block text-xs text-muted">{REASON[v.reason] ?? v.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-40 rounded-lg border border-line p-4">
            {preview ? (
              <>
                <div className="note-editor max-h-[45vh] overflow-y-auto">
                  <div className="ProseMirror" style={{ minHeight: 0 }} dangerouslySetInnerHTML={{ __html: preview.html }} />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    loading={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await beforeRestore();
                        await api(`/api/notes/versions/${preview.id}/restore`, { method: "POST" });
                        onRestored();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Restaurar esta versión
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Elige una versión para verla.</p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
