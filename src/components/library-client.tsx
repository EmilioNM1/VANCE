"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button } from "./ui";

export function CreateLibraryForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setLoading(true);
        setError(null);
        try {
          const r = await api<{ library: { id: string } }>("/api/libraries", { body: { name: f.get("name"), subject: f.get("subject") || null } });
          form.reset();
          router.push(`/app/library/${r.library.id}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error");
        } finally {
          setLoading(false);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="lib-name">Nombre de la biblioteca</label>
        <input id="lib-name" name="name" className="input" placeholder="p. ej. Fisiología II" required maxLength={120} />
      </div>
      <div>
        <label className="label" htmlFor="lib-subject">Asignatura o proyecto (opcional)</label>
        <input id="lib-subject" name="subject" className="input" placeholder="Medicina · 2.º curso" maxLength={120} />
      </div>
      <Button type="submit" loading={loading}>Crear</Button>
      {error && <div className="sm:col-span-3"><Alert tone="danger">{error}</Alert></div>}
    </form>
  );
}

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp";

export function UploadForm({ libraryId, maxMb }: { libraryId: string; maxMb: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [rights, setRights] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) return setError(`El archivo supera ${maxMb} MB.`);
    setFile(f);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return setError("Elige un archivo.");
        const f = new FormData(e.currentTarget);
        const fd = new FormData();
        fd.set("file", file);
        fd.set("libraryId", libraryId);
        fd.set("title", String(f.get("title") ?? ""));
        fd.set("topic", String(f.get("topic") ?? ""));
        fd.set("rightsConfirmed", rights ? "true" : "false");
        setLoading(true);
        setError(null);
        try {
          const r = await api<{ document: { id: string } }>("/api/documents", { form: fd });
          router.push(`/app/documents/${r.document.id}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Error al subir");
          setLoading(false);
        }
      }}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${drag ? "border-accent-500 bg-accent-50 dark:bg-accent-900/20" : "border-line "}`}
      >
        <p className="text-sm font-medium">{file ? file.name : "Arrastra aquí tu archivo"}</p>
        <p className="mt-1 text-xs text-muted">PDF (con texto o escaneado), DOCX, PPTX, TXT, MD o imágenes de apuntes · máx. {maxMb} MB</p>
        <Button type="button" variant="secondary" className="mt-3" onClick={() => input.current?.click()}>
          {file ? "Cambiar archivo" : "Elegir archivo"}
        </Button>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Archivo" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="doc-title">Título (opcional)</label>
          <input id="doc-title" name="title" className="input" maxLength={200} placeholder="Se usa el nombre del archivo" />
        </div>
        <div>
          <label className="label" htmlFor="doc-topic">Tema o capítulo (opcional)</label>
          <input id="doc-topic" name="topic" className="input" maxLength={200} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
        <span>
          Confirmo que tengo derecho a usar este material para mi estudio personal y entiendo que su contenido se enviará a un proveedor de IA para analizarlo. El archivo solo es visible para mí.
        </span>
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" loading={loading} disabled={!file || !rights}>Subir y procesar</Button>
    </form>
  );
}

export function DangerButton({ url, confirmText, label, redirectTo, body }: { url: string; confirmText: string; label: string; redirectTo?: string; body?: unknown }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="secondary"
      className="text-rose-600"
      loading={loading}
      onClick={async () => {
        if (!confirm(confirmText)) return;
        setLoading(true);
        try {
          await api(url, { method: body ? "POST" : "DELETE", body });
          if (redirectTo) router.push(redirectTo);
          router.refresh();
        } catch (e) {
          alert(e instanceof Error ? e.message : "Error");
        } finally {
          setLoading(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
