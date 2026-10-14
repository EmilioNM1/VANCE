import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getDocument } from "@/server/documents/service";
import { listClaimsForReport } from "@/server/verification/audit";
import { loadOr404 } from "@/server/page-helpers";
import { Alert, Card, EmptyState, PageHeader, Stat, clsx } from "@/components/ui";
import { BulkAcceptButton, ClaimCard } from "@/components/claim-card";
import { ActionButton } from "@/components/document-client";

export const metadata = { title: "Verificación" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "VERIFIED", label: "Información verificada" },
  { key: "NEEDS_REVIEW", label: "Requiere revisión" },
  { key: "CORRECTION", label: "Correcciones propuestas" },
] as const;

export default async function VerificationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const doc = await loadOr404(() => getDocument(user.id, id));
  const claims = await listClaimsForReport(user.id, id);
  const count = (k: string) => claims.filter((c) => c.category === k).length;
  const tab = TABS.find((t) => t.key === tabParam)?.key ?? (count("CORRECTION") ? "CORRECTION" : count("NEEDS_REVIEW") ? "NEEDS_REVIEW" : "VERIFIED");
  const shown = claims.filter((c) => c.category === tab);
  const validated = claims.filter((c) => c.validated).length;
  const pendingDecisions = claims.filter((c) => !c.validated && c.decision === "PENDING").length;
  const unverifiableIds = claims.filter((c) => c.verdict === "UNVERIFIABLE" && c.decision === "PENDING").map((c) => c.id);
  const canBuild = ["REVIEW", "READY", "FAILED"].includes(doc.status) && !!doc.auditCompletedAt && !doc.isDemo;

  return (
    <>
      <PageHeader back={{ href: `/app/documents/${id}`, label: doc.title }} title="Informe de verificación" subtitle="La fidelidad al documento y la validez científica son cosas distintas: un texto bien transcrito puede contener errores." />
      {!doc.auditCompletedAt && !doc.isDemo ? (
        <EmptyState title="La auditoría aún no ha terminado">Vuelve cuando el documento esté en «Revisión pendiente».</EmptyState>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Verificadas" value={count("VERIFIED")} hint="con fuente comprobada" />
            <Stat label="Requieren revisión" value={count("NEEDS_REVIEW")} />
            <Stat label="Correcciones" value={count("CORRECTION")} />
            <Stat label="Se usarán para aprender" value={`${validated}/${claims.length}`} />
          </div>
          <Alert tone="info">
            Solo las afirmaciones marcadas como «Se usará para aprender» alimentan el conocimiento y las actividades. Las fuentes mostradas son las que devolvieron realmente PubMed o la búsqueda web; cualquier referencia que no pudo comprobarse se descarta.
            {pendingDecisions > 0 && ` Quedan ${pendingDecisions} afirmaciones sin decidir que se excluirán si continúas.`}
          </Alert>
          {canBuild && (
            <Card className="my-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                {doc.status === "READY" ? "El conocimiento ya está generado. Si cambias decisiones, puedes regenerarlo (se perderá el historial de práctica de este documento)." : "Cuando termines la revisión, genera el mapa de conocimiento y las actividades."}
              </p>
              <ActionButton
                url={`/api/documents/${id}/approve`}
                label={doc.status === "READY" ? "Regenerar conocimiento" : `Generar conocimiento con ${validated} afirmaciones`}
                variant="primary"
                redirect={`/app/documents/${id}`}
                confirmText={doc.status === "READY" ? "Se regenerarán conceptos y actividades y se perderá el historial de práctica de este documento. ¿Continuar?" : undefined}
              />
            </Card>
          )}
          <div className="mb-4 mt-4 flex gap-1 overflow-x-auto border-b border-ink-100 dark:border-ink-800" role="tablist">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`?tab=${t.key}`}
                role="tab"
                aria-selected={tab === t.key}
                className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-accent-600 text-accent-700 dark:text-accent-300" : "border-transparent text-ink-500 hover:text-ink-800")}
              >
                {t.label} ({count(t.key)})
              </Link>
            ))}
          </div>
          {tab === "NEEDS_REVIEW" && !doc.isDemo && <div className="mb-3"><BulkAcceptButton documentId={id} claimIds={unverifiableIds} /></div>}
          {shown.length === 0 ? (
            <EmptyState title="Nada en esta categoría" />
          ) : (
            <div className="space-y-3">
              {shown.map((c) => <ClaimCard key={c.id} claim={c} readOnly={doc.isDemo} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}
