"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Spinner } from "./ui";

const ACTIVE = ["UPLOADED", "EXTRACTING", "AUDITING", "BUILDING_KNOWLEDGE"];

/** Consulta el estado del procesamiento y refresca la página cuando cambia. */
export function StatusPoller({ documentId, status, detail }: { documentId: string; status: string; detail: string | null }) {
  const router = useRouter();
  const [live, setLive] = useState({ status, detail });
  const last = useRef(status);
  useEffect(() => {
    setLive({ status, detail });
    last.current = status;
  }, [status, detail]);
  useEffect(() => {
    if (!ACTIVE.includes(live.status)) return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ status: string; statusDetail: string | null }>(`/api/documents/${documentId}/status`);
        setLive({ status: r.status, detail: r.statusDetail });
        if (r.status !== last.current) {
          last.current = r.status;
          router.refresh();
        }
      } catch {
        /* reintenta en el siguiente ciclo */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [documentId, live.status, router]);
  if (!ACTIVE.includes(live.status)) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-900 dark:border-accent-900 dark:bg-accent-950/30 dark:text-accent-100" role="status" aria-live="polite">
      <Spinner className="h-4 w-4" />
      <span>{live.detail ?? "Procesando…"}</span>
    </div>
  );
}

export function ActionButton({ url, body, label, variant = "secondary", confirmText, redirect }: { url: string; body?: unknown; label: string; variant?: "primary" | "secondary"; confirmText?: string; redirect?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        variant={variant}
        loading={loading}
        onClick={async () => {
          if (confirmText && !confirm(confirmText)) return;
          setLoading(true);
          setError(null);
          try {
            await api(url, { body: body ?? {} });
            if (redirect) router.push(redirect);
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Error");
          } finally {
            setLoading(false);
          }
        }}
      >
        {label}
      </Button>
      {error && <span className="mt-1 max-w-xs text-xs text-rose-600" role="alert">{error}</span>}
    </span>
  );
}

export function ChunkEditor({ chunkId, text, editedText }: { chunkId: string; text: string; editedText: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(editedText ?? text);
  const [saving, setSaving] = useState(false);
  const save = async (v: string | null) => {
    setSaving(true);
    try {
      await api(`/api/chunks/${chunkId}`, { method: "PATCH", body: { editedText: v } });
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };
  if (!editing)
    return (
      <div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text/90">{editedText ?? text}</p>
        <div className="mt-2 flex gap-3 text-xs">
          <button className="text-accent-600 hover:underline" onClick={() => setEditing(true)}>Corregir extracción</button>
          {editedText !== null && (
            <button className="text-muted hover:underline" onClick={() => save(null)}>Restaurar original</button>
          )}
        </div>
      </div>
    );
  return (
    <div>
      <label className="sr-only" htmlFor={`chunk-${chunkId}`}>Texto del fragmento</label>
      <textarea id={`chunk-${chunkId}`} className="input min-h-40 font-mono text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="mt-2 flex gap-2">
        <Button loading={saving} onClick={() => save(value)}>Guardar</Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
      </div>
      <p className="mt-1 text-xs text-muted">Se conserva el texto original. Tras corregir, vuelve a ejecutar la verificación para que se use el texto corregido.</p>
    </div>
  );
}
