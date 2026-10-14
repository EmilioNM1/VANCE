"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";

/** Búsqueda en todos los apuntes del usuario (texto completo en el servidor). */
export function NotesSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; notebook_title: string; section_title: string; snippet: string }[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const r = await api<{ results: NonNullable<typeof results> }>(`/api/notes/search?q=${encodeURIComponent(q)}`).catch(() => ({ results: [] }));
      setResults(r.results);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <label htmlFor="notes-search" className="sr-only">Buscar en tus apuntes</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input id="notes-search" className="input h-10 pl-9" placeholder="Buscar en tus apuntes" value={q} onChange={(e) => setQ(e.target.value)} />
      {results && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-float" role="listbox">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">Sin resultados.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <Link href={`/app/notebooks/page/${r.id}`} className="block rounded-md px-3 py-2 hover:bg-sunken">
                <span className="block text-sm font-medium">{r.title}</span>
                <span className="block text-xs text-muted">
                  {r.notebook_title} · {r.section_title}
                </span>
                {r.snippet && <span className="mt-0.5 block text-xs text-text/70" dangerouslySetInnerHTML={{ __html: escapeSnippet(r.snippet) }} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Escapa el fragmento y solo convierte los marcadores «» del servidor en resaltado. */
function escapeSnippet(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/«/g, '<mark class="rounded bg-amber-200/70 px-0.5 dark:bg-amber-500/30">')
    .replace(/»/g, "</mark>");
}
