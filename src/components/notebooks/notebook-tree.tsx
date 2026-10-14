"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, Copy, FilePlus2, FolderInput, MoreHorizontal, Pencil, Plus, Trash2, ArrowUp, ArrowDown, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { NOTEBOOK_DOT } from "@/lib/labels";
import { Button, clsx } from "../ui";
import { Dialog, Menu } from "../ui-overlays";

export interface TreePage {
  id: string;
  title: string;
  ord: number;
}
export interface TreeSection {
  id: string;
  title: string;
  ord: number;
  pages: TreePage[];
}
export interface TreeNotebook {
  id: string;
  title: string;
  color: string;
  subject?: string | null;
}

type Prompt = { title: string; label: string; initial: string; onSubmit: (v: string) => Promise<void> };

function usePromptDialog() {
  const [p, setP] = useState<Prompt | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (x: Prompt) => {
    setValue(x.initial);
    setError(null);
    setP(x);
  };
  const dialog = (
    <Dialog open={!!p} onClose={() => setP(null)} title={p?.title ?? ""}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!p || !value.trim()) return;
          setBusy(true);
          try {
            await p.onSubmit(value.trim());
            setP(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <label className="label" htmlFor="prompt-input">{p?.label}</label>
          <input id="prompt-input" className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} />
        </div>
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!value.trim()}>
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  );
  return { open, dialog };
}

/** Diálogo «Mover a…»: elige cuaderno y sección de destino. */
function MoveDialog({ open, onClose, kind, onMove }: { open: boolean; onClose: () => void; kind: "page" | "section"; onMove: (target: { notebookId: string; sectionId?: string }) => Promise<void> }) {
  const [notebooks, setNotebooks] = useState<TreeNotebook[]>([]);
  const [nb, setNb] = useState("");
  const [sections, setSections] = useState<TreeSection[]>([]);
  const [sec, setSec] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    void api<{ notebooks: TreeNotebook[] }>("/api/notebooks").then((r) => {
      setNotebooks(r.notebooks);
      setNb(r.notebooks[0]?.id ?? "");
    });
  }, [open]);
  useEffect(() => {
    if (!nb || kind !== "page") return;
    void api<{ sections: TreeSection[] }>(`/api/notebooks/${nb}`).then((r) => {
      setSections(r.sections);
      setSec(r.sections[0]?.id ?? "");
    });
  }, [nb, kind]);
  return (
    <Dialog open={open} onClose={onClose} title={kind === "page" ? "Mover página" : "Mover sección"}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="move-nb">Cuaderno</label>
          <select id="move-nb" className="input" value={nb} onChange={(e) => setNb(e.target.value)}>
            {notebooks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </div>
        {kind === "page" && (
          <div>
            <label className="label" htmlFor="move-sec">Sección</label>
            <select id="move-sec" className="input" value={sec} onChange={(e) => setSec(e.target.value)}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end">
          <Button
            loading={busy}
            disabled={!nb || (kind === "page" && !sec)}
            onClick={async () => {
              setBusy(true);
              try {
                await onMove({ notebookId: nb, sectionId: sec || undefined });
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Mover
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Explorador del cuaderno: secciones plegables con sus páginas.
 * Todas las operaciones (crear, renombrar, mover, ordenar, duplicar, eliminar) están disponibles
 * desde menús accesibles con teclado y táctiles.
 */
export function NotebookTree({ notebook, sections, currentPageId, onNavigate }: { notebook: TreeNotebook; sections: TreeSection[]; currentPageId?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const storage = `vance-tree-${notebook.id}`;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [move, setMove] = useState<null | { kind: "page" | "section"; id: string }>(null);
  const prompt = usePromptDialog();
  useEffect(() => {
    try {
      setCollapsed(JSON.parse(localStorage.getItem(storage) ?? "{}"));
    } catch {
      /* ignorar */
    }
  }, [storage]);
  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try {
      localStorage.setItem(storage, JSON.stringify(next));
    } catch {
      /* ignorar */
    }
  };
  const refresh = () => router.refresh();
  const call = async (url: string, method: string, body?: unknown) => {
    try {
      return await api(url, { method, body });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
      throw e;
    }
  };
  const newPage = async (sectionId: string) => {
    const r = (await call(`/api/notebooks/sections/${sectionId}/pages`, "POST", {})) as { page: { id: string } };
    onNavigate?.();
    router.push(`/app/notebooks/page/${r.page.id}`);
    router.refresh();
  };
  const reorderPage = async (sectionId: string, pageId: string, delta: number) => {
    const sec = sections.find((s) => s.id === sectionId)!;
    const idx = sec.pages.findIndex((p) => p.id === pageId);
    await call(`/api/notes/pages/${pageId}`, "PATCH", { index: Math.max(0, idx + delta) });
    refresh();
  };
  const reorderSection = async (sectionId: string, delta: number) => {
    const ids = sections.map((s) => s.id);
    const i = ids.indexOf(sectionId);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await call(`/api/notebooks/${notebook.id}/sections`, "PUT", { ids });
    refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", NOTEBOOK_DOT[notebook.color] ?? NOTEBOOK_DOT.teal)} />
        <Link href={`/app/notebooks/${notebook.id}`} onClick={onNavigate} className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold hover:text-accent-700">
          {notebook.title}
        </Link>
        <Menu
          label="Opciones del cuaderno"
          trigger={<MoreHorizontal className="h-4 w-4 text-muted" />}
          items={[
            { label: "Nueva sección", icon: <Plus className="h-4 w-4" />, onSelect: () => prompt.open({ title: "Nueva sección", label: "Nombre", initial: "", onSubmit: async (v) => { await call(`/api/notebooks/${notebook.id}/sections`, "POST", { title: v }); refresh(); } }) },
            { label: "Renombrar cuaderno", icon: <Pencil className="h-4 w-4" />, onSelect: () => prompt.open({ title: "Renombrar cuaderno", label: "Nombre", initial: notebook.title, onSubmit: async (v) => { await call(`/api/notebooks/${notebook.id}`, "PATCH", { title: v }); refresh(); } }) },
          ]}
        />
      </div>
      <nav aria-label={`Secciones de ${notebook.title}`} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {sections.map((s, si) => {
          const isCollapsed = !!collapsed[s.id];
          return (
            <div key={s.id} className="mb-1">
              <div className="group flex items-center rounded-md hover:bg-sunken">
                <button type="button" onClick={() => toggle(s.id)} aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1.5 text-left">
                  <ChevronRight className={clsx("h-3.5 w-3.5 shrink-0 text-muted transition-transform", !isCollapsed && "rotate-90")} />
                  <span className="truncate text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted">{s.title}</span>
                </button>
                <button type="button" onClick={() => newPage(s.id)} className="rounded p-1 text-muted opacity-100 hover:text-accent-700 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100" aria-label={`Nueva página en ${s.title}`} title="Nueva página">
                  <FilePlus2 className="h-3.5 w-3.5" />
                </button>
                <span className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                  <Menu
                    label={`Opciones de la sección ${s.title}`}
                    trigger={<span className="flex rounded p-1 text-muted"><MoreHorizontal className="h-3.5 w-3.5" /></span>}
                    items={[
                      { label: "Nueva página", icon: <FilePlus2 className="h-4 w-4" />, onSelect: () => newPage(s.id) },
                      { label: "Renombrar", icon: <Pencil className="h-4 w-4" />, onSelect: () => prompt.open({ title: "Renombrar sección", label: "Nombre", initial: s.title, onSubmit: async (v) => { await call(`/api/notebooks/sections/${s.id}`, "PATCH", { title: v }); refresh(); } }) },
                      { label: "Duplicar", icon: <Copy className="h-4 w-4" />, onSelect: async () => { await call(`/api/notebooks/sections/${s.id}/duplicate`, "POST"); refresh(); } },
                      { label: "Mover a otro cuaderno", icon: <FolderInput className="h-4 w-4" />, onSelect: () => setMove({ kind: "section", id: s.id }) },
                      { label: "Subir", icon: <ArrowUp className="h-4 w-4" />, onSelect: () => reorderSection(s.id, -1), disabled: si === 0 },
                      { label: "Bajar", icon: <ArrowDown className="h-4 w-4" />, onSelect: () => reorderSection(s.id, 1), disabled: si === sections.length - 1 },
                      "separator",
                      { label: "Eliminar sección", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: async () => { if (confirm(`¿Eliminar «${s.title}» y sus ${s.pages.length} páginas? No se puede deshacer.`)) { await call(`/api/notebooks/sections/${s.id}`, "DELETE"); refresh(); } } },
                    ]}
                  />
                </span>
              </div>
              {!isCollapsed && (
                <ul className="ml-3 border-l border-line pl-1.5">
                  {s.pages.length === 0 && (
                    <li>
                      <button type="button" onClick={() => newPage(s.id)} className="px-2 py-1 text-[13px] text-muted hover:text-accent-700">
                        + Añadir página
                      </button>
                    </li>
                  )}
                  {s.pages.map((p, pi) => (
                    <li key={p.id} className={clsx("group flex items-center rounded-md", p.id === currentPageId ? "bg-surface ring-1 ring-line" : "hover:bg-sunken")}>
                      <Link
                        href={`/app/notebooks/page/${p.id}`}
                        onClick={onNavigate}
                        aria-current={p.id === currentPageId ? "page" : undefined}
                        className={clsx("flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[14px]", p.id === currentPageId ? "font-medium text-text" : "text-text/80")}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
                        <span className="truncate">{p.title}</span>
                      </Link>
                      <span className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                        <Menu
                          label={`Opciones de la página ${p.title}`}
                          trigger={<span className="flex rounded p-1 text-muted"><MoreHorizontal className="h-3.5 w-3.5" /></span>}
                          items={[
                            { label: "Renombrar", icon: <Pencil className="h-4 w-4" />, onSelect: () => prompt.open({ title: "Renombrar página", label: "Título", initial: p.title, onSubmit: async (v) => { await call(`/api/notes/pages/${p.id}`, "PATCH", { title: v }); refresh(); } }) },
                            { label: "Duplicar", icon: <Copy className="h-4 w-4" />, onSelect: async () => { await call(`/api/notes/pages/${p.id}/duplicate`, "POST"); refresh(); } },
                            { label: "Mover a…", icon: <FolderInput className="h-4 w-4" />, onSelect: () => setMove({ kind: "page", id: p.id }) },
                            { label: "Subir", icon: <ArrowUp className="h-4 w-4" />, onSelect: () => reorderPage(s.id, p.id, -1), disabled: pi === 0 },
                            { label: "Bajar", icon: <ArrowDown className="h-4 w-4" />, onSelect: () => reorderPage(s.id, p.id, 1), disabled: pi === s.pages.length - 1 },
                            "separator",
                            {
                              label: "Eliminar página",
                              icon: <Trash2 className="h-4 w-4" />,
                              danger: true,
                              onSelect: async () => {
                                if (!confirm(`¿Eliminar «${p.title}»? Se eliminarán también sus preguntas de repaso. No se puede deshacer.`)) return;
                                await call(`/api/notes/pages/${p.id}`, "DELETE");
                                if (p.id === currentPageId) router.push(`/app/notebooks/${notebook.id}`);
                                refresh();
                              },
                            },
                          ]}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => prompt.open({ title: "Nueva sección", label: "Nombre", initial: "", onSubmit: async (v) => { await call(`/api/notebooks/${notebook.id}/sections`, "POST", { title: v }); refresh(); } })}
          className="mt-2 flex items-center gap-1.5 px-2 py-1 text-[13px] text-muted hover:text-accent-700"
        >
          <Plus className="h-3.5 w-3.5" /> Nueva sección
        </button>
      </nav>
      {prompt.dialog}
      <MoveDialog
        open={!!move}
        kind={move?.kind ?? "page"}
        onClose={() => setMove(null)}
        onMove={async ({ notebookId, sectionId }) => {
          if (!move) return;
          if (move.kind === "page") await call(`/api/notes/pages/${move.id}`, "PATCH", { sectionId });
          else await call(`/api/notebooks/sections/${move.id}`, "PATCH", { notebookId });
          refresh();
        }}
      />
    </div>
  );
}
