"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "../ui";
import { useQuickPage } from "../app-nav";

export function QuickPageButton({ variant = "primary" }: { variant?: "primary" | "quiet" }) {
  const { create, busy } = useQuickPage();
  return (
    <Button variant={variant} size={variant === "quiet" ? "sm" : "lg"} onClick={create} loading={busy}>
      {!busy && <Plus className="h-4 w-4" />} Nueva página
    </Button>
  );
}

/** Crear un cuaderno en un paso y abrir directamente su primera página. */
export function NewNotebookInline({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ pageId: string }>("/api/notebooks", { body: { title } });
          router.push(`/app/notebooks/page/${r.pageId}`);
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error");
          setBusy(false);
        }
      }}
    >
      <label htmlFor="new-notebook" className="sr-only">Nombre del cuaderno</label>
      <input id="new-notebook" className="input h-10 flex-1" placeholder="Nombre del cuaderno (p. ej. Fisiología)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus={autoFocus} />
      <Button type="submit" loading={busy} disabled={!title.trim()} size="lg" className="h-10">
        Crear y escribir
      </Button>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </form>
  );
}
