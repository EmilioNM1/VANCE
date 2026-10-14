"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { BookOpen, Check, ExternalLink, Link2, Quote, ScanSearch, Search, Sparkles, X, CircleAlert, CircleCheck, CircleHelp, Library } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Spinner, clsx } from "../ui";
import { StartSessionButton } from "../start-session-button";
import { findTextRange } from "../editor/text-range";

export interface LinkedDoc {
  id: string;
  title: string;
  status: string;
  pageCount: number | null;
  libraryName: string;
}

// ───────────────────────────── Libro: consultar sin salir del editor ─────────────────────────────

interface Passage {
  documentId: string;
  documentTitle: string;
  chunkId: string | null;
  page: number | null;
  text: string;
  provider: string;
}

export function ReferencePanel({ pageId, editor, linked, allDocuments, geminiEnabled, onLinksChanged }: { pageId: string; editor: Editor | null; linked: LinkedDoc[]; allDocuments: { id: string; title: string }[]; geminiEnabled: boolean; onLinksChanged: () => void }) {
  const [q, setQ] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [results, setResults] = useState<Passage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const available = allDocuments.filter((d) => !linked.some((l) => l.id === d.id));

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ passages: Passage[] }>(`/api/notes/pages/${pageId}/search?q=${encodeURIComponent(q)}${semantic ? "&semantic=1" : ""}`);
      setResults(r.passages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const insertQuote = (p: Passage) => {
    if (!editor) return;
    const href = `/app/documents/${p.documentId}${p.chunkId ? `#chunk-${p.chunkId}` : ""}`;
    const excerpt = p.text.length > 700 ? `${p.text.slice(0, 700).replace(/\s\S*$/, "")}…` : p.text;
    editor
      .chain()
      .focus()
      .insertContent([
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: excerpt }] }, { type: "paragraph", content: [{ type: "text", text: `— ${p.documentTitle}${p.page ? `, pág. ${p.page}` : ""}`, marks: [{ type: "link", attrs: { href } }] }] }] },
        { type: "paragraph" },
      ])
      .run();
  };

  const link = async (documentId: string) => {
    await api(`/api/notes/pages/${pageId}/links`, { body: { documentId } });
    onLinksChanged();
  };
  const unlink = async (documentId: string) => {
    await api(`/api/notes/pages/${pageId}/links`, { method: "DELETE", body: { documentId } });
    onLinksChanged();
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Libros de referencia</h3>
        {linked.length === 0 && <p className="mb-2 text-sm text-muted">Vincula un libro a esta página para consultarlo y contrastar tus apuntes con él.</p>}
        <ul className="space-y-1.5">
          {linked.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <BookOpen className="h-4 w-4 shrink-0 text-accent-600" />
              <Link href={`/app/documents/${d.id}`} target="_blank" className="min-w-0 flex-1 truncate text-sm hover:underline">
                {d.title}
              </Link>
              {d.status !== "READY" && <Badge tone="warning">sin validar</Badge>}
              <button type="button" onClick={() => unlink(d.id)} className="rounded p-0.5 text-muted hover:text-rose-600" aria-label={`Desvincular ${d.title}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        {available.length > 0 ? (
          <div className="mt-2 flex gap-2">
            <label htmlFor="link-doc" className="sr-only">Vincular un libro</label>
            <select id="link-doc" className="input h-9 flex-1" defaultValue="" onChange={(e) => e.target.value && void link(e.target.value)}>
              <option value="">+ Vincular un libro…</option>
              {available.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          allDocuments.length === 0 && (
            <Link href="/app/library" className="mt-2 inline-flex items-center gap-1.5 text-sm text-accent-700 hover:underline dark:text-accent-300">
              <Library className="h-4 w-4" /> Sube tu primer libro
            </Link>
          )
        )}
      </section>

      <section>
        <form onSubmit={search} role="search">
          <label htmlFor="ref-q" className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
            Buscar en {linked.length ? "los libros vinculados" : "toda tu biblioteca"}
          </label>
          <div className="flex gap-2">
            <input id="ref-q" className="input h-9 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="p. ej. liberación de calcio" />
            <Button type="submit" size="md" variant="secondary" loading={loading} aria-label="Buscar">
              {!loading && <Search className="h-4 w-4" />}
            </Button>
          </div>
          {geminiEnabled && (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} /> Búsqueda semántica (Gemini File Search)
            </label>
          )}
        </form>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        {results && (
          <ul className="mt-3 space-y-3" aria-live="polite">
            {results.length === 0 && <li className="text-sm text-muted">Sin resultados en el libro. Prueba con otros términos.</li>}
            {results.map((p, i) => {
              const key = `${p.documentId}-${p.chunkId ?? i}`;
              const open = expanded === key;
              return (
                <li key={key} className="rounded-lg border border-line bg-surface p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="truncate font-medium text-text/80">{p.documentTitle}</span>
                    <span className="shrink-0">{p.page ? `pág. ${p.page}` : "página no disponible"}</span>
                  </div>
                  <p className={clsx("font-serif text-[14.5px] leading-relaxed", !open && "line-clamp-5")}>{p.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {p.text.length > 320 && (
                      <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : key)}>
                        {open ? "Menos" : "Leer más"}
                      </Button>
                    )}
                    <Button size="sm" variant="quiet" onClick={() => insertQuote(p)} disabled={!editor}>
                      <Quote className="h-3.5 w-3.5" /> Insertar cita
                    </Button>
                    <Link href={`/app/documents/${p.documentId}${p.chunkId ? `#chunk-${p.chunkId}` : ""}`} target="_blank" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted hover:bg-sunken hover:text-text">
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir
                    </Link>
                    {p.provider !== "LOCAL" && <Badge tone="info">semántica</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ───────────────────────────── Revisión: contrastar apuntes con las fuentes ─────────────────────────────

interface SourceDTO {
  id: string;
  retrievedVia: "BOOK" | "PUBMED" | "WEB_SEARCH";
  title: string;
  url: string;
  page: number | null;
  pmid: string | null;
  excerpt: string | null;
  stance: string;
  documentId: string | null;
}
interface NoteClaim {
  id: string;
  originalText: string;
  quote: string | null;
  verdict: string;
  category: "VERIFIED" | "NEEDS_REVIEW" | "CORRECTION";
  proposedText: string | null;
  rationale: string | null;
  decision: string;
  validated: boolean;
  finalText: string | null;
  sources: SourceDTO[];
}
interface ReviewDTO {
  review: null | {
    id: string;
    status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
    statusDetail: string | null;
    scope: string;
    error: string | null;
    retrievalProvider: string | null;
    omissions: { description: string; documentId: string; documentTitle: string; page: number | null; chunkId: string | null; excerpt: string }[];
    createdAt: string;
  };
  claims: NoteClaim[];
}

const SOURCE_LABEL = { BOOK: "Libro", PUBMED: "PubMed", WEB_SEARCH: "Fuente web" } as const;

export function ReviewPanel({
  pageId,
  editor,
  aiEnabled,
  stale,
  selectionRequest,
  onSelectionHandled,
  flushSave,
}: {
  pageId: string;
  editor: Editor | null;
  aiEnabled: boolean;
  stale: boolean;
  selectionRequest: string | null;
  onSelectionHandled: () => void;
  flushSave: () => Promise<boolean>;
}) {
  const [data, setData] = useState<ReviewDTO | null>(null);
  const [external, setExternal] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => setData(await api<ReviewDTO>(`/api/notes/pages/${pageId}/review`)), [pageId]);
  useEffect(() => {
    void load();
  }, [load]);
  const running = data?.review?.status === "QUEUED" || data?.review?.status === "RUNNING";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [running, load]);

  const analyze = useCallback(
    async (scope: "PAGE" | "SELECTION", selectionText?: string) => {
      setStarting(true);
      setError(null);
      try {
        await flushSave();
        await api(`/api/notes/pages/${pageId}/analyze`, { body: { scope, selectionText, externalVerification: external } });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setStarting(false);
      }
    },
    [pageId, external, load, flushSave],
  );
  useEffect(() => {
    if (selectionRequest) {
      void analyze("SELECTION", selectionRequest);
      onSelectionHandled();
    }
  }, [selectionRequest, analyze, onSelectionHandled]);

  const showInText = (c: NoteClaim) => {
    if (!editor || !c.quote) return;
    const r = findTextRange(editor.state.doc, c.quote);
    if (!r) {
      setNotice("No se encuentra ese fragmento en la página (puede que lo hayas editado).");
      return;
    }
    editor.chain().focus().setTextSelection(r).scrollIntoView().run();
  };

  const decide = async (c: NoteClaim, decision: "ACCEPTED_CORRECTION" | "ACCEPTED_ORIGINAL" | "REJECTED" | "PENDING") => {
    setNotice(null);
    try {
      const r = await api<{ replace: { from: string; to: string } | null }>(`/api/notes/claims/${c.id}/decision`, { body: { decision } });
      if (r.replace && editor) {
        const range = findTextRange(editor.state.doc, r.replace.from);
        if (range) {
          editor.chain().focus().insertContentAt(range, r.replace.to).run();
          setNotice("Corrección aplicada. Se guardó una versión anterior de la página por si quieres recuperarla.");
        } else setNotice("Corrección aceptada, pero el texto original ya no está en la página: no se ha modificado nada.");
      }
      await load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Error");
    }
  };

  const groups: { key: NoteClaim["category"]; title: string; icon: typeof CircleAlert; tone: string }[] = [
    { key: "CORRECTION", title: "Correcciones propuestas", icon: CircleAlert, tone: "text-rose-600" },
    { key: "NEEDS_REVIEW", title: "Requiere tu revisión", icon: CircleHelp, tone: "text-amber-600" },
    { key: "VERIFIED", title: "Coincide con tus fuentes", icon: CircleCheck, tone: "text-emerald-600" },
  ];

  if (!aiEnabled)
    return (
      <p className="text-sm leading-relaxed text-muted">
        Contrastar apuntes con los libros requiere configurar el proveedor de IA en el servidor. Mientras tanto puedes consultar el libro en la pestaña «Libro».
      </p>
    );

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-surface p-4">
        <p className="text-sm leading-relaxed text-text/85">
          Compara tus apuntes con tus libros: detecta errores y omisiones y propone correcciones con su referencia. Tu texto original nunca se pierde.
        </p>
        {stale && data?.review && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Hay contenido nuevo desde el último análisis.</p>}
        <label className="mt-3 flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5" checked={external} onChange={(e) => setExternal(e.target.checked)} />
          Si el libro no lo cubre, consultar fuentes externas fiables (PubMed y búsqueda web)
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => analyze("PAGE")} loading={starting || running} disabled={running}>
            {!(starting || running) && <ScanSearch className="h-4 w-4" />} Analizar esta página
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">También puedes seleccionar un fragmento y elegir «Contrastar con el libro».</p>
        {running && (
          <p className="mt-3 flex items-center gap-2 text-sm text-accent-700 dark:text-accent-300" role="status">
            <Spinner className="h-4 w-4" /> {data?.review?.statusDetail ?? "En cola…"}
          </p>
        )}
        {data?.review?.status === "FAILED" && <p className="mt-3 text-sm text-rose-600">El análisis no pudo completarse: {data.review.error}</p>}
        {error && <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p>}
      </section>
      {notice && <p className="rounded-lg bg-sunken px-3 py-2 text-sm" role="status">{notice}</p>}

      {data?.review?.status === "DONE" && data.claims.length === 0 && <p className="text-sm text-muted">No se encontraron afirmaciones con contenido que contrastar.</p>}

      {groups.map((g) => {
        const list = (data?.claims ?? []).filter((c) => c.category === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key}>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
              <g.icon className={clsx("h-3.5 w-3.5", g.tone)} /> {g.title} ({list.length})
            </h3>
            <ul className="space-y-2.5">
              {list.map((c) => (
                <li key={c.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Tus apuntes</p>
                  <p className={clsx("mt-0.5 font-serif text-[15px] leading-relaxed", c.decision === "ACCEPTED_CORRECTION" && "text-muted line-through")}>{c.quote ?? c.originalText}</p>
                  {c.rationale && <p className="mt-2 text-[13px] leading-relaxed text-text/80">{c.rationale}</p>}
                  {c.proposedText && c.category === "CORRECTION" && (
                    <div className="mt-2 rounded-md bg-emerald-50 px-2.5 py-2 dark:bg-emerald-900/25">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Propuesta</p>
                      <p className="mt-0.5 font-serif text-[15px] leading-relaxed">{c.proposedText}</p>
                    </div>
                  )}
                  {c.sources.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {c.sources.map((s) => (
                        <li key={s.id} className="text-xs">
                          <Badge tone={s.retrievedVia === "BOOK" ? "accent" : "info"}>{SOURCE_LABEL[s.retrievedVia]}</Badge>{" "}
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent-700 underline dark:text-accent-300">
                            {s.title}
                            {s.page ? `, pág. ${s.page}` : ""}
                            {s.pmid ? ` (PMID ${s.pmid})` : ""}
                          </a>
                          {s.excerpt && <span className="mt-0.5 block italic text-muted">«{s.excerpt}»</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.category !== "VERIFIED" && c.sources.length === 0 && <p className="mt-2 text-xs text-muted">Sin fuente que lo respalde: no se usará para crear preguntas hasta que lo apruebes.</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.quote && (
                      <Button size="sm" variant="ghost" onClick={() => showInText(c)}>
                        Ver en el texto
                      </Button>
                    )}
                    {c.decision === "PENDING" ? (
                      <>
                        {c.proposedText && c.category === "CORRECTION" && (
                          <Button size="sm" onClick={() => decide(c, "ACCEPTED_CORRECTION")}>
                            <Check className="h-3.5 w-3.5" /> Aceptar corrección
                          </Button>
                        )}
                        {c.category !== "VERIFIED" && (
                          <Button size="sm" variant="secondary" onClick={() => decide(c, "ACCEPTED_ORIGINAL")}>
                            Mantener mi texto
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => decide(c, "REJECTED")}>
                          Descartar
                        </Button>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-xs text-muted">
                        {{ ACCEPTED_CORRECTION: "Corrección aceptada", ACCEPTED_ORIGINAL: "Aprobado por ti", EDITED: "Editado", REJECTED: "Descartado" }[c.decision] ?? c.decision}
                        <button type="button" className="underline" onClick={() => decide(c, "PENDING")}>
                          deshacer
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {data?.review?.omissions && data.review.omissions.length > 0 && (
        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">El libro menciona y tus apuntes no</h3>
          <ul className="space-y-2">
            {data.review.omissions.map((o, i) => (
              <li key={i} className="rounded-lg border border-dashed border-line p-3 text-sm">
                <p>{o.description}</p>
                <Link href={`/app/documents/${o.documentId}${o.chunkId ? `#chunk-${o.chunkId}` : ""}`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-xs text-accent-700 hover:underline dark:text-accent-300">
                  <Link2 className="h-3 w-3" /> {o.documentTitle}
                  {o.page ? `, pág. ${o.page}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data?.review?.status === "DONE" && (
        <p className="text-xs text-muted">
          Búsqueda en el libro: {data.review.retrievalProvider?.includes("gemini") ? "Gemini File Search" : "búsqueda de texto completo"}. Solo se muestran referencias realmente recuperadas.
        </p>
      )}
    </div>
  );
}

// ───────────────────────────── Estudiar: de los apuntes al sistema de repasos ─────────────────────────────

const PRACTICE = [
  { types: ["PROCESS_ORDER"], label: "Reconstruir un mecanismo" },
  { types: ["EXPLAIN", "FREE_RECALL"], label: "Explicar con mis palabras" },
  { types: ["DIAGRAM"], label: "Completar el esquema" },
  { types: ["RELATION"], label: "Relacionar conceptos" },
  { types: ["CASE", "PREDICTION"], label: "Resolver un caso" },
];

export function StudyPanel({ pageId, sectionId, aiEnabled, conceptCount, flushSave, onBuilt }: { pageId: string; sectionId: string; aiEnabled: boolean; conceptCount: number; flushSave: () => Promise<boolean>; onBuilt: () => void }) {
  const [mode, setMode] = useState<"NOTES" | "BOOK" | "COMBINED">("COMBINED");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<null | { status: string; result: null | { noteConcepts: number; bookConcepts: number; created: number; reused: number; rejected: number; messages: string[] }; error: string | null }>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const j = await api<NonNullable<typeof job>>(`/api/jobs/${jobId}`).catch(() => null);
      if (!j) return;
      setJob(j);
      if (j.status === "DONE" || j.status === "FAILED") {
        clearInterval(t);
        setJobId(null);
        onBuilt();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [jobId, onBuilt]);

  const build = async () => {
    setError(null);
    setJob(null);
    try {
      await flushSave();
      const r = await api<{ jobId: string }>(`/api/notes/pages/${pageId}/activities`, { body: { mode } });
      setJobId(r.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-surface p-4">
        <h3 className="title-serif text-base">Crear preguntas de repaso</h3>
        <p className="mt-1 text-sm text-muted">Se identifican los conceptos importantes (no una pregunta por frase) y solo se usa información validada.</p>
        <div role="radiogroup" aria-label="Origen de las preguntas" className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1">
          {(
            [
              ["NOTES", "Mis apuntes"],
              ["BOOK", "El libro"],
              ["COMBINED", "Ambos"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={clsx("rounded-md px-2 py-1.5 text-[13px] font-medium", mode === k ? "bg-surface text-text shadow-card" : "text-muted")}>
              {label}
            </button>
          ))}
        </div>
        <Button className="mt-3 w-full" onClick={build} loading={!!jobId} disabled={!aiEnabled && mode !== "BOOK"}>
          {!jobId && <Sparkles className="h-4 w-4" />} {jobId ? "Preparando preguntas…" : "Crear preguntas"}
        </Button>
        {!aiEnabled && mode !== "BOOK" && <p className="mt-2 text-xs text-muted">Crear preguntas desde tus apuntes requiere IA. Las del libro vinculado se reutilizan sin coste.</p>}
        {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        {job?.status === "FAILED" && <p className="mt-2 text-sm text-rose-600">No se pudieron crear: {job.error}</p>}
        {job?.result && (
          <div className="mt-3 rounded-md bg-sunken px-3 py-2 text-sm" role="status">
            <p>
              {job.result.created} preguntas nuevas · {job.result.reused} reutilizadas · {job.result.noteConcepts} conceptos de tus apuntes · {job.result.bookConcepts} del libro
            </p>
            {job.result.messages.map((m, i) => (
              <p key={i} className="mt-1 text-xs text-muted">
                {m}
              </p>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Practicar ({conceptCount} conceptos vinculados)</h3>
        <div className="grid gap-2">
          <StartSessionButton mode="PAGE" pageId={pageId}>
            Estudiar esta página
          </StartSessionButton>
          <div className="grid grid-cols-2 gap-2">
            <StartSessionButton mode="PAGE" pageId={pageId} focus="ERRORS" variant="secondary" size="sm">
              Repasar mis errores
            </StartSessionButton>
            <StartSessionButton mode="SECTION" notebookSectionId={sectionId} variant="secondary" size="sm">
              Toda la sección
            </StartSessionButton>
            <StartSessionButton mode="PAGE" pageId={pageId} focus="NOTES" variant="secondary" size="sm">
              Solo mis apuntes
            </StartSessionButton>
            <StartSessionButton mode="PAGE" pageId={pageId} focus="COMBINED" variant="secondary" size="sm">
              Apuntes + libro
            </StartSessionButton>
          </div>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Practicar una habilidad</h3>
        <div className="flex flex-wrap gap-2">
          {PRACTICE.map((p) => (
            <StartSessionButton key={p.label} mode="PAGE" pageId={pageId} types={p.types} variant="ghost" size="sm">
              {p.label}
            </StartSessionButton>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Los repasos de esta página también aparecen en tu agenda general, junto al resto de tu material.</p>
      </section>
    </div>
  );
}
