import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getDashboardStats } from "@/server/analytics/stats";
import { ACTIVITY_LABELS } from "@/lib/types";
import { Alert, Badge, Card, EmptyState, MASTERY_LABEL, PageHeader, Progress, Stat, formatDate } from "@/components/ui";

export const metadata = { title: "Progreso" };
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Barras de una sola serie con tooltip nativo; la tabla equivalente va debajo. */
function Bars({ data, label }: { data: { key: string; label: string; value: number | null; n: number }[]; label: string }) {
  return (
    <div className="flex h-36 items-end gap-2" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${pct(d.value)}`).join(", ")}`}>
      {data.map((d) => (
        <div key={d.key} className="group flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${pct(d.value)} (${d.n} repasos)`}>
          <span className="text-[11px] tabular-nums text-ink-500 opacity-0 transition group-hover:opacity-100">{pct(d.value)}</span>
          <div className="w-full max-w-10 rounded-t bg-accent-500 transition group-hover:bg-accent-600" style={{ height: d.value === null ? 2 : `${Math.max(2, d.value * 100)}px`, opacity: d.value === null ? 0.25 : 1 }} />
          <span className="text-center text-[10px] leading-tight text-ink-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export default async function StatsPage() {
  const user = await requireUser();
  const s = await getDashboardStats(user.id);
  if (s.totalConcepts === 0)
    return (
      <>
        <PageHeader title="Progreso" />
        <EmptyState title="Aún no hay datos">Las estadísticas aparecen cuando practicas con documentos procesados. No mostramos cifras inventadas.</EmptyState>
      </>
    );
  const r = s.retention;
  const buckets = [
    { key: "i", label: "Mismo día", ...r.immediate },
    { key: "a", label: "1–7 días", ...r.days1to7 },
    { key: "b", label: "7–30 días", ...r.days7to30 },
    { key: "c", label: "+30 días", ...r.days30plus },
  ];
  return (
    <>
      <PageHeader title="Progreso" subtitle="Rendimiento observado en tus actividades. No es una medida directa de tu memoria biológica." />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Conceptos" value={s.totalConcepts} hint={`${s.byState.MASTERED} parecen dominados`} />
        <Stat label="Hoy" value={`${s.goals.itemsToday}/${s.goals.dailyReviewGoal}`} hint="actividades vs objetivo" />
        <Stat label="Esta semana" value={`${s.time.weekMinutes} min`} hint={`objetivo ${s.goals.weeklyMinutesGoal} min`} />
        <Stat label="Respuestas con pistas" value={s.hints.attempts ? pct(s.hints.withHints / s.hints.attempts) : "—"} hint={`${s.hints.attempts} respuestas en total`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Recuerdo inmediato vs. demorado</h2>
          <p className="mb-4 text-xs text-ink-500">Puntuación media del primer intento según el tiempo transcurrido desde el repaso anterior. Lo que cuenta para la memoria a largo plazo son las columnas de la derecha.</p>
          <Bars data={buckets.map((b) => ({ key: b.key, label: b.label, value: b.avgScore, n: b.n }))} label="Recuerdo según intervalo" />
          <table className="mt-4 w-full text-xs">
            <thead className="text-left text-ink-500">
              <tr><th className="font-medium">Intervalo</th><th className="font-medium">Repasos</th><th className="font-medium">Media</th><th className="font-medium">Recuerdo fluido</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {buckets.map((b) => (
                <tr key={b.key}><td>{b.label}</td><td>{b.n}</td><td>{pct(b.avgScore)}</td><td>{pct(b.successRate)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <h2 className="font-semibold">Evolución semanal</h2>
          <p className="mb-4 text-xs text-ink-500">Media del primer intento por semana (últimas 8).</p>
          <Bars data={s.weekly.map((w) => ({ key: w.weekStart, label: new Date(w.weekStart).toLocaleDateString("es-ES", { day: "numeric", month: "short" }), value: w.avgScore, n: w.n }))} label="Evolución semanal" />
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-ink-500">Ver como tabla</summary>
            <table className="mt-2 w-full tabular-nums">
              <tbody>
                {s.weekly.map((w) => (
                  <tr key={w.weekStart}><td>{w.weekStart}</td><td>{w.n} repasos</td><td>{pct(w.avgScore)}</td><td>{pct(w.independent)} sin pistas</td></tr>
                ))}
              </tbody>
            </table>
          </details>
          {s.calibration.n >= 10 && (
            <p className="mt-3 text-xs text-ink-500">
              Calibración personal: recuerdas el {pct(s.calibration.observed / s.calibration.predicted)} de lo que el modelo predecía; tus intervalos se ajustan ×{s.calibration.factor.toFixed(2)}.
            </p>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Por documento</h2>
        <ul className="space-y-4">
          {s.documents.map((d) => {
            const solid = d.states.CONSOLIDATING + d.states.MASTERED;
            return (
              <li key={d.documentId}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Link href={`/app/documents/${d.documentId}/concepts`} className="font-medium hover:underline">{d.title}</Link>
                  <span className="text-xs text-ink-500">{d.library}</span>
                </div>
                <Progress value={(solid / d.total) * 100} tone="success" label={`Consolidación de ${d.title}`} />
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  {(["RELEARNING", "NEW", "LEARNING", "CONSOLIDATING", "MASTERED"] as const).map((k) =>
                    d.states[k] ? <Badge key={k} tone={MASTERY_LABEL[k]!.tone}>{MASTERY_LABEL[k]!.label}: {d.states[k]}</Badge> : null,
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {s.illusions.length > 0 && (
        <div className="mt-4">
          <Alert tone="warning" title="Falsa sensación de aprendizaje">
            Aciertas con opciones pero no al explicarlo sin ayuda: {s.illusions.map((c) => <Link key={c.id} href={`/app/concepts/${c.id}`} className="mr-2 underline">{c.name}</Link>)}
          </Alert>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Errores frecuentes</h2>
          {s.errors.length === 0 ? (
            <p className="text-sm text-ink-500">No se han detectado errores conceptuales.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.errors.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span>
                    <Link href={`/app/concepts/${e.conceptId}`} className="font-medium hover:underline">{e.conceptName}</Link>: {e.description}
                  </span>
                  <span className="shrink-0 text-xs text-ink-500">{e.count}× {e.resolved ? "· corregido" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Conceptos que confundes</h2>
          {s.confusions.length === 0 ? (
            <p className="text-sm text-ink-500">Sin confusiones registradas.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.confusions.map((c, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span><Link href={`/app/concepts/${c.aId}`} className="font-medium hover:underline">{c.a}</Link> ↔ {c.b}</span>
                  <span className="text-xs text-ink-500">{c.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Historial de intentos</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-ink-500">
              <tr><th className="py-1 font-medium">Fecha</th><th className="font-medium">Concepto</th><th className="font-medium">Actividad</th><th className="font-medium">Fase</th><th className="font-medium">Pista</th><th className="text-right font-medium">Resultado</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {s.history.map((h) => (
                <tr key={h.id}>
                  <td className="py-1.5 text-xs text-ink-500">{formatDate(h.createdAt, true)}</td>
                  <td>{h.conceptName}</td>
                  <td className="text-xs">{ACTIVITY_LABELS[h.type]}</td>
                  <td className="text-xs">{{ INITIAL: "1.er intento", RETRY: "reintento", POST_EXPLANATION: "tras explicación" }[h.phase]}</td>
                  <td className="text-xs">{h.hintLevel || "—"}</td>
                  <td className="text-right tabular-nums">{Math.round(h.score * 100)}%{h.provisional ? "*" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-500">* evaluación provisional sin IA.</p>
      </Card>
    </>
  );
}
