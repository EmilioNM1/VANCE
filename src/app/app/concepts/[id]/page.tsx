import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getConceptDetail } from "@/server/knowledge/build";
import { getConceptProgress } from "@/server/analytics/stats";
import { loadOr404 } from "@/server/page-helpers";
import { DIMENSION_LABELS } from "@/server/memory/mastery";
import { ACTIVITY_LABELS, type MasteryDimensions } from "@/lib/types";
import { Alert, Badge, Card, MASTERY_LABEL, PageHeader, Progress, formatDate, relativeDue } from "@/components/ui";
import { StartSessionButton } from "@/components/start-session-button";
import { KIND_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await loadOr404(() => getConceptDetail(user.id, id));
  const progress = await getConceptProgress(user.id, id);
  const { concept: c, document: doc } = detail;
  const m = progress.mastery;
  const st = MASTERY_LABEL[m?.state ?? "NEW"]!;
  const dims = m?.dimensions as MasteryDimensions | undefined;

  return (
    <>
      <PageHeader
        back={{ href: `/app/documents/${doc.id}/concepts`, label: doc.title }}
        title={c.name}
        subtitle={<span className="flex flex-wrap gap-2"><Badge>{KIND_LABEL[c.kind]}</Badge><Badge tone={st.tone}>{st.label}</Badge></span>}
        actions={<StartSessionButton mode="CONCEPT" conceptId={c.id}>Practicar este concepto</StartSessionButton>}
      />
      <Alert tone="info">Consejo: intenta explicar este concepto de memoria antes de leer el resumen. Leer no es lo mismo que recordar.</Alert>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <details className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
            <summary className="cursor-pointer font-semibold">Ver resumen y estructura</summary>
            <p className="mt-3 text-sm leading-relaxed">{c.summary}</p>
            {c.details.steps && (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                {c.details.steps.map((s, i) => <li key={i}>{s.text}</li>)}
              </ol>
            )}
            {c.details.formula && (
              <div className="mt-3 text-sm">
                <p className="font-mono">{c.details.formula.expression}</p>
                <ul className="mt-1 text-xs text-ink-500">{c.details.formula.variables.map((v) => <li key={v.symbol}>{v.symbol}: {v.meaning}</li>)}</ul>
              </div>
            )}
            {(["examples", "exceptions", "applications"] as const).map((k) =>
              c.details[k]?.length ? (
                <div key={k} className="mt-3 text-sm">
                  <p className="font-medium">{{ examples: "Ejemplos", exceptions: "Excepciones", applications: "Aplicaciones" }[k]}</p>
                  <ul className="list-disc pl-5">{c.details[k]!.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ) : null,
            )}
          </details>
          <Card>
            <h2 className="mb-2 font-semibold">Fuentes en el documento</h2>
            <ul className="space-y-2 text-sm">
              {detail.claims.map((cl) => (
                <li key={cl.id} className="border-l-2 border-accent-200 pl-3">
                  <p>{cl.text}</p>
                  <p className="text-xs text-ink-500">
                    {cl.page ? `Página ${cl.page} · ` : ""}
                    {cl.basis === "EXTERNAL_SOURCE" ? "verificada con fuentes" : cl.basis === "USER_EDITED" ? "editada por ti" : "aprobada por ti (sin verificación externa)"}
                    {cl.text !== cl.original && " · corregida respecto al original"}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          {(detail.relationsOut.length > 0 || detail.relationsIn.length > 0) && (
            <Card>
              <h2 className="mb-2 font-semibold">Conceptos relacionados</h2>
              <ul className="space-y-1 text-sm">
                {[...detail.relationsOut, ...detail.relationsIn].map((r) => (
                  <li key={r.id}>
                    <Link href={`/app/concepts/${r.otherId}`} className="font-medium text-accent-600 hover:underline">{r.otherName}</Link>
                    <span className="text-ink-500"> — {r.description}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h2 className="mb-2 font-semibold">Actividades disponibles</h2>
            <ul className="flex flex-wrap gap-2">
              {progress.activities.map((a) => <Badge key={a.id} tone={a.type === "RECOGNITION" ? "neutral" : "accent"}>{ACTIVITY_LABELS[a.type]}</Badge>)}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">Perfil de dominio</h2>
            <p className="mb-3 text-xs text-ink-500">Rendimiento observado en actividades; no es una medida directa de tu memoria.</p>
            {!m ? (
              <p className="text-sm text-ink-500">Aún no has practicado este concepto.</p>
            ) : (
              <>
                {m.illusionFlag && <div className="mb-3"><Alert tone="warning">Lo reconoces entre opciones, pero aún no lo recuperas sin ayuda.</Alert></div>}
                <ul className="space-y-2.5">
                  {(Object.keys(DIMENSION_LABELS) as (keyof MasteryDimensions)[]).map((k) => {
                    const d = dims?.[k];
                    return (
                      <li key={k}>
                        <div className="mb-0.5 flex justify-between text-xs">
                          <span>{DIMENSION_LABELS[k]}</span>
                          <span className="tabular-nums text-ink-500">{d?.value === null || d === undefined ? "sin datos" : `${Math.round(d.value * 100)}% · ${d.n}`}</span>
                        </div>
                        <Progress value={(d?.value ?? 0) * 100} label={DIMENSION_LABELS[k]} />
                      </li>
                    );
                  })}
                </ul>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-ink-500">Próximo repaso</dt>
                  <dd>{relativeDue(m.dueAt)}</dd>
                  <dt className="text-ink-500">Estabilidad estimada</dt>
                  <dd>{m.stability < 1 ? `${Math.round(m.stability * 24)} h` : `${m.stability.toFixed(1)} días`}</dd>
                  <dt className="text-ink-500">Repasos / olvidos</dt>
                  <dd>{m.reps} / {m.lapses}</dd>
                  <dt className="text-ink-500">Días con recuerdo independiente</dt>
                  <dd>{m.independentSuccessDays.length}</dd>
                </dl>
              </>
            )}
          </Card>
          {progress.errors.length > 0 && (
            <Card>
              <h2 className="mb-2 font-semibold">Tus errores en este concepto</h2>
              <ul className="space-y-2 text-sm">
                {progress.errors.map((e) => (
                  <li key={e.id}>
                    <p>{e.description}</p>
                    <p className="text-xs text-ink-500">{e.count} vez/veces · {e.resolved ? "corregido" : "pendiente de corregir"} · {formatDate(e.lastSeenAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {progress.logs.length > 0 && (
            <Card>
              <h2 className="mb-2 font-semibold">Historial</h2>
              <ul className="space-y-1 text-xs">
                {progress.logs.slice(0, 12).map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span>{formatDate(l.createdAt, true)} · {ACTIVITY_LABELS[l.activityType]}</span>
                    <span className="tabular-nums">{Math.round(l.score * 100)}%{l.hintsUsed ? ` · pista ${l.hintsUsed}` : ""}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
