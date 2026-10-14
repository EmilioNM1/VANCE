"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, type Tone } from "./ui";

export interface ClaimDTO {
  id: string;
  kind: string;
  originalText: string;
  quote: string | null;
  quoteVerified: boolean;
  verdict: string;
  category: string;
  proposedText: string | null;
  rationale: string | null;
  decision: string;
  finalText: string | null;
  validated: boolean;
  validationBasis: string | null;
  page: number | null;
  verificationMethod: string | null;
  sources: { id: string; retrievedVia: string; title: string; url: string; pmid: string | null; doi: string | null; journal: string | null; year: string | null; excerpt: string | null; stance: string }[];
}

const VERDICT: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendiente", tone: "neutral" },
  SUPPORTED: { label: "Respaldada por fuentes", tone: "success" },
  CONFIRMED_ERROR: { label: "Error confirmado", tone: "danger" },
  POSSIBLE_ERROR: { label: "Posible error", tone: "warning" },
  OUTDATED: { label: "Posiblemente desactualizada", tone: "warning" },
  SOURCE_DISAGREEMENT: { label: "Discrepancia entre fuentes", tone: "warning" },
  UNVERIFIABLE: { label: "No verificable", tone: "neutral" },
  EXTRACTION_ERROR: { label: "Error de extracción", tone: "warning" },
  INTERNAL_CONTRADICTION: { label: "Contradicción interna", tone: "danger" },
};

const DECISION: Record<string, string> = {
  ACCEPTED_ORIGINAL: "Aceptada tal cual",
  ACCEPTED_CORRECTION: "Corrección aceptada",
  EDITED: "Editada por ti",
  REJECTED: "Excluida",
};

export function ClaimCard({ claim, readOnly }: { claim: ClaimDTO; readOnly?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(claim.finalText ?? claim.proposedText ?? claim.originalText);
  const [error, setError] = useState<string | null>(null);
  const v = VERDICT[claim.verdict] ?? VERDICT.PENDING!;

  const decide = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/claims/${claim.id}/decision`, { body });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-ink-100 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={v.tone}>{v.label}</Badge>
        <Badge>{claim.kind.replace("_", " ").toLowerCase()}</Badge>
        {claim.page && <span className="text-ink-500">Página {claim.page}</span>}
        {claim.validated ? <Badge tone="success">Se usará para aprender</Badge> : <Badge tone="neutral">No se usará</Badge>}
        {claim.decision !== "PENDING" && <Badge tone="accent">{DECISION[claim.decision]}</Badge>}
        {!claim.quoteVerified && <Badge tone="warning">Cita no localizada en el texto</Badge>}
      </div>
      <p className={claim.proposedText && claim.decision === "ACCEPTED_CORRECTION" ? "text-sm text-ink-400 line-through" : "text-sm"}>
        <span className="sr-only">Texto original: </span>
        {claim.originalText}
      </p>
      {claim.proposedText && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <span className="font-medium">Corrección propuesta: </span>
          {claim.proposedText}
        </p>
      )}
      {claim.decision === "EDITED" && claim.finalText && <p className="mt-2 rounded-lg bg-accent-50 px-3 py-2 text-sm dark:bg-accent-900/30">Tu versión: {claim.finalText}</p>}
      {claim.rationale && <p className="mt-2 text-xs leading-relaxed text-ink-500">{claim.rationale}</p>}
      {claim.sources.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {claim.sources.map((s) => (
            <li key={s.id} className="text-xs">
              <Badge tone={s.stance === "SUPPORTS" ? "success" : s.stance === "CONTRADICTS" ? "danger" : "warning"}>{s.stance === "SUPPORTS" ? "respalda" : s.stance === "CONTRADICTS" ? "contradice" : "mixta"}</Badge>{" "}
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-600 underline">
                {s.title}
              </a>
              <span className="text-ink-500">
                {" "}
                · {s.retrievedVia === "PUBMED" ? `PubMed PMID ${s.pmid}${s.journal ? `, ${s.journal}` : ""}${s.year ? ` (${s.year})` : ""}${s.doi ? `, DOI ${s.doi}` : ""}` : "búsqueda web"}
              </span>
              {s.excerpt && <p className="mt-0.5 italic text-ink-500">«{s.excerpt}»</p>}
            </li>
          ))}
        </ul>
      )}
      {claim.quote && (
        <details className="mt-2 text-xs text-ink-500">
          <summary className="cursor-pointer">Fragmento original</summary>
          <blockquote className="mt-1 border-l-2 border-ink-200 pl-2">{claim.quote}</blockquote>
        </details>
      )}
      {!readOnly && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3 dark:border-ink-800">
          {editing ? (
            <div className="w-full">
              <label className="sr-only" htmlFor={`edit-${claim.id}`}>Texto corregido</label>
              <textarea id={`edit-${claim.id}`} className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="mt-2 flex gap-2">
                <Button loading={busy} onClick={() => decide({ decision: "EDITED", text })}>Guardar mi versión</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <>
              {claim.proposedText && claim.decision !== "ACCEPTED_CORRECTION" && (
                <Button loading={busy} onClick={() => decide({ decision: "ACCEPTED_CORRECTION" })}>Aceptar corrección</Button>
              )}
              {!claim.validated && (
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => {
                    if (["CONFIRMED_ERROR", "POSSIBLE_ERROR", "INTERNAL_CONTRADICTION"].includes(claim.verdict) && !confirm("Se ha detectado un posible problema en esta afirmación. ¿Seguro que quieres aprenderla tal cual?")) return;
                    void decide({ decision: "ACCEPTED_ORIGINAL" });
                  }}
                >
                  Aceptar original
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>Editar</Button>
              {claim.decision !== "REJECTED" && (
                <Button variant="ghost" loading={busy} onClick={() => decide({ decision: "REJECTED" })}>Excluir</Button>
              )}
              {claim.decision !== "PENDING" && (
                <Button variant="ghost" loading={busy} onClick={() => decide({ decision: "PENDING" })}>Deshacer</Button>
              )}
            </>
          )}
          {error && <p className="w-full text-xs text-rose-600" role="alert">{error}</p>}
        </div>
      )}
    </article>
  );
}

export function BulkAcceptButton({ documentId, claimIds }: { documentId: string; claimIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!claimIds.length) return null;
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        if (!confirm(`Vas a aceptar ${claimIds.length} afirmaciones que NO se pudieron verificar con fuentes externas. Quedarán marcadas como "aprobadas por ti", no como verificadas. ¿Continuar?`)) return;
        setBusy(true);
        try {
          await api(`/api/documents/${documentId}/bulk-accept`, { body: { claimIds } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Aceptar todas las no verificables ({claimIds.length})
    </Button>
  );
}
