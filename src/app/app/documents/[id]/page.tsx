import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getDocumentOverview } from "@/server/documents/service";
import { loadOr404 } from "@/server/page-helpers";
import { aiConfigured } from "@/server/ai";
import { Alert, Badge, ButtonLink, Card, DOC_STATUS, PageHeader, clsx, formatDate } from "@/components/ui";
import { ActionButton, ChunkEditor, StatusPoller } from "@/components/document-client";
import { DangerButton } from "@/components/library-client";
import { StartSessionButton } from "@/components/start-session-button";

import { Page } from "@/components/page-container";

export const dynamic = "force-dynamic";

const STEPS = [
  { key: "extract", label: "Extracción", done: ["EXTRACTED", "AUDITING", "REVIEW", "BUILDING_KNOWLEDGE", "READY"] },
  { key: "audit", label: "Verificación", done: ["REVIEW", "BUILDING_KNOWLEDGE", "READY"] },
  { key: "review", label: "Tu revisión", done: ["BUILDING_KNOWLEDGE", "READY"] },
  { key: "knowledge", label: "Conocimiento y actividades", done: ["READY"] },
];

const METHOD: Record<string, string> = {
  "pdf-text": "Texto del PDF",
  "ocr-ai": "OCR con IA",
  docx: "Documento Word",
  pptx: "Presentación",
  text: "Texto plano",
  "vision-ai": "Reconocimiento de imagen con IA",
};

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const ov = await loadOr404(() => getDocumentOverview(user.id, id));
  const d = ov.document;
  const ai = aiConfigured();
  const st = DOC_STATUS[d.status]!;
  const claimsTotal = ov.claimStats.reduce((a, c) => a + c.n, 0);
  const validated = ov.claimStats.filter((c) => c.validated).reduce((a, c) => a + c.n, 0);
  const chunksBySection = new Map<string | null, typeof ov.chunks>();
  for (const c of ov.chunks) chunksBySection.set(c.sectionId, [...(chunksBySection.get(c.sectionId) ?? []), c]);

  return (
    <Page wide>
      <PageHeader
        back={{ href: `/app/library/${ov.library.id}`, label: ov.library.name }}
        title={d.title}
        subtitle={`${d.originalFilename} · subido ${formatDate(d.createdAt)}${d.pageCount ? ` · ${d.pageCount} páginas` : ""}${d.extractionMethod ? ` · ${METHOD[d.extractionMethod] ?? d.extractionMethod}` : ""}`}
        actions={
          <>
            {d.status === "READY" && <StartSessionButton mode="DOCUMENT" documentId={d.id}>Estudiar este documento</StartSessionButton>}
            {!d.isDemo && <DangerButton url={`/api/documents/${d.id}`} label="Eliminar" confirmText="Se eliminará el documento, su conocimiento, actividades e historial. ¿Continuar?" redirectTo={`/app/library/${ov.library.id}`} />}
          </>
        }
      />
      {d.isDemo && <div className="mb-4"><Alert tone="warning" title="Datos de demostración">Este documento y su conocimiento se crearon con el script de demostración, no con un procesamiento real de IA.</Alert></div>}

      <Card className="mb-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          {claimsTotal > 0 && <span className="text-sm text-muted">{validated} de {claimsTotal} afirmaciones validadas · {ov.conceptCount} conceptos</span>}
          {d.indexProvider && (
            <Badge tone={d.indexStatus === "INDEXED" ? "accent" : d.indexStatus === "FAILED" ? "danger" : "neutral"}>
              Búsqueda semántica: {d.indexStatus === "INDEXED" ? "indexado" : d.indexStatus === "FAILED" ? "error al indexar" : "indexando…"}
            </Badge>
          )}
        </div>
        <ol className="grid gap-2 sm:grid-cols-4">
          {STEPS.map((s, i) => {
            const done = s.done.includes(d.status);
            return (
              <li key={s.key} className={clsx("rounded-lg border px-3 py-2 text-sm", done ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" : "border-line text-muted ")}>
                <span className="mr-1 font-semibold">{i + 1}.</span> {s.label} {done && "✓"}
              </li>
            );
          })}
        </ol>
        <div className="mt-4 space-y-3">
          <StatusPoller documentId={d.id} status={d.status} detail={d.statusDetail} />
          {d.status === "FAILED" && d.error && (
            <Alert tone="danger" title="El procesamiento no pudo completarse">
              <p>{d.error}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {d.errorCode !== "NO_TEXT_NEEDS_OCR" || ai ? <ActionButton url={`/api/documents/${d.id}/reprocess`} body={{ stage: d.errorCode === "AUDIT_FAILED" ? "audit" : d.errorCode === "KNOWLEDGE_FAILED" ? "knowledge" : "extract" }} label="Reintentar" variant="primary" /> : null}
              </div>
            </Alert>
          )}
          {d.status === "REVIEW" && (
            <Alert tone="warning" title="Revisa el informe de verificación">
              Antes de generar actividades, revisa qué afirmaciones se han verificado, cuáles requieren tu revisión y qué correcciones se proponen.
              <div className="mt-3"><ButtonLink href={`/app/documents/${d.id}/verification`}>Abrir informe</ButtonLink></div>
            </Alert>
          )}
          {d.status === "EXTRACTED" && (
            <Alert tone="info">
              {d.statusDetail}
              {ai && (
                <div className="mt-3"><ActionButton url={`/api/documents/${d.id}/reprocess`} body={{ stage: "audit" }} label="Iniciar verificación" variant="primary" /></div>
              )}
            </Alert>
          )}
          {d.status === "READY" && (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/app/documents/${d.id}/concepts`} variant="secondary">Explorar conceptos</ButtonLink>
              <ButtonLink href={`/app/documents/${d.id}/verification`} variant="secondary">Informe de verificación</ButtonLink>
              <p className="w-full text-xs text-muted">{d.statusDetail}</p>
            </div>
          )}
        </div>
        {d.warnings.length > 0 && (
          <div className="mt-4">
            <Alert tone="warning" title="Avisos de la extracción">
              <ul className="list-disc pl-5">
                {d.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </Alert>
          </div>
        )}
        {!d.isDemo && ["REVIEW", "READY", "FAILED", "EXTRACTED"].includes(d.status) && ov.chunks.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted">Volver a procesar…</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton url={`/api/documents/${d.id}/reprocess`} body={{ stage: "extract" }} label="Extraer de nuevo" confirmText="Se borrarán los fragmentos, la verificación, los conceptos y el historial de este documento. ¿Continuar?" />
              {ai && <ActionButton url={`/api/documents/${d.id}/reprocess`} body={{ stage: "audit" }} label="Repetir verificación" confirmText="Se rehará la verificación (usando tus correcciones de extracción) y se borrarán conceptos y actividades. ¿Continuar?" />}
              {ai && d.auditCompletedAt && <ActionButton url={`/api/documents/${d.id}/reprocess`} body={{ stage: "knowledge" }} label="Regenerar conocimiento" confirmText="Se regenerarán conceptos y actividades (se pierde el historial de práctica de este documento). ¿Continuar?" />}
            </div>
          </details>
        )}
      </Card>

      {ov.sections.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Material procesado</h2>
          <p className="mb-4 text-sm text-muted">Revisa el texto extraído. Si detectas errores de extracción, corrígelos: el original se conserva.</p>
          <div className="space-y-4">
            {ov.sections.map((s) => (
              <Card key={s.id}>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mb-3 text-xs text-muted">{s.pageStart ? `Págs. ${s.pageStart}${s.pageEnd && s.pageEnd !== s.pageStart ? `–${s.pageEnd}` : ""}` : "Sin paginación"}</p>
                <div className="space-y-4">
                  {(chunksBySection.get(s.id) ?? []).map((c) => (
                    <div key={c.id} id={`chunk-${c.id}`} className="scroll-mt-24 target:rounded-r-md target:bg-accent-50 dark:target:bg-accent-900/30 border-l-2 border-line pl-3">
                      <div className="mb-1 flex flex-wrap gap-2 text-xs text-muted">
                        {c.page && <span>Página {c.page}</span>}
                        {c.editedText !== null && <Badge tone="info">Corregido por ti</Badge>}
                        {c.warnings.map((w, i) => <Badge key={i} tone="warning">{w}</Badge>)}
                      </div>
                      {d.isDemo ? <p className="whitespace-pre-wrap text-sm">{c.text}</p> : <ChunkEditor chunkId={c.id} text={c.text} editedText={c.editedText} />}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-muted">
        <Link href="/app/library" className="hover:underline">Volver a la biblioteca</Link>
      </p>
    </Page>
  );
}
