"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, MoreHorizontal, Palette, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { NOTEBOOK_DOT } from "@/lib/labels";
import { Button, clsx } from "../ui";
import { Dialog, Menu } from "../ui-overlays";

export function NotebookActions({ notebook }: { notebook: { id: string; title: string; color: string; subject: string | null } }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(notebook.title);
  const [subject, setSubject] = useState(notebook.subject ?? "");
  const [color, setColor] = useState(notebook.color);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Menu
        label="Opciones del cuaderno"
        trigger={
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium">
            <MoreHorizontal className="h-4 w-4" /> Opciones
          </span>
        }
        items={[
          { label: "Editar nombre y color", icon: <Pencil className="h-4 w-4" />, onSelect: () => setEdit(true) },
          {
            label: "Duplicar cuaderno",
            icon: <Copy className="h-4 w-4" />,
            onSelect: async () => {
              const r = await api<{ notebook: { id: string } }>(`/api/notebooks/${notebook.id}/duplicate`, { method: "POST" });
              router.push(`/app/notebooks/${r.notebook.id}`);
              router.refresh();
            },
          },
          "separator",
          {
            label: "Eliminar cuaderno",
            icon: <Trash2 className="h-4 w-4" />,
            danger: true,
            onSelect: async () => {
              if (!confirm(`¿Eliminar «${notebook.title}» con todas sus secciones y páginas? No se puede deshacer.`)) return;
              await api(`/api/notebooks/${notebook.id}`, { method: "DELETE" });
              router.push("/app/notebooks");
              router.refresh();
            },
          },
        ]}
      />
      <Dialog open={edit} onClose={() => setEdit(false)} title="Editar cuaderno">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(`/api/notebooks/${notebook.id}`, { method: "PATCH", body: { title, subject: subject || null, color } });
              setEdit(false);
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <label className="label" htmlFor="nb-title">Nombre</label>
            <input id="nb-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </div>
          <div>
            <label className="label" htmlFor="nb-subject">Asignatura (opcional)</label>
            <input id="nb-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
          </div>
          <fieldset>
            <legend className="label flex items-center gap-1.5">
              <Palette className="h-4 w-4" /> Color
            </legend>
            <div className="flex gap-2">
              {Object.entries(NOTEBOOK_DOT).map(([k, cls]) => (
                <button key={k} type="button" onClick={() => setColor(k)} aria-label={k} aria-pressed={color === k} className={clsx("h-7 w-7 rounded-full ring-offset-2 ring-offset-surface", cls, color === k && "ring-2 ring-text")} />
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Guardar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
