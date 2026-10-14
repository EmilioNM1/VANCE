import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getDashboardStats } from "@/server/analytics/stats";
import { dueCount, listActiveSessions } from "@/server/study/session";
import { listDocuments } from "@/server/documents/service";
import { Alert, Badge, ButtonLink, Card, DOC_STATUS, EmptyState, MASTERY_LABEL, PageHeader, Progress, Stat, formatDate } from "@/components/ui";
import { StartSessionButton } from "@/components/start-session-button";

export const metadata = { title: "Panel" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser();
  const [stats, due, active, docs] = await Promise.all([getDashboardStats(user.id), dueCount(user.id), listActiveSessions(user.id), listDocuments(user.id)]);
  const goalPct = Math.min(100, (stats.goals.itemsToday / stats.goals.dailyReviewGoal) * 100);
  const processing = docs.filter((d) => !["READY", "FAILED"].includes(d.status));
  const review = docs.filter((d) => d.status === "REVIEW");

  return (
    <>
      <PageHeader title={`Hola, ${user.name.split(" ")[0]}`} subtitle="Recuperar de memoria es lo que consolida el aprendizaje. Empieza por lo que toca hoy." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Sesión de hoy</h2>
              <p className="mt-1 text-sm text-ink-500">
                {due.due > 0 ? `${due.due} concepto(s) con repaso pendiente` : "No tienes repasos vencidos"}
                {due.fresh > 0 ? ` · ${due.fresh} concepto(s) nuevos por practicar` : ""}
              </p>
            </div>
            {stats.totalConcepts > 0 ? (
              <StartSessionButton mode="DAILY">{due.due + due.fresh > 0 ? "Empezar sesión diaria" : "Repaso acumulativo"}</StartSessionButton>
            ) : (
              <ButtonLink href="/app/library">Sube tu primer documento</ButtonLink>
            )}
          </div>
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-xs text-ink-500">
              <span>Objetivo diario de actividades</span>
              <span className="tabular-nums">{stats.goals.itemsToday} / {stats.goals.dailyReviewGoal}</span>
            </div>
            <Progress value={goalPct} tone="success" label="Objetivo diario" />
          </div>
          {active.length > 0 && (
            <div className="mt-5 border-t border-ink-100 pt-4 dark:border-ink-800">
              <p className="mb-2 text-sm font-medium">Sesiones sin terminar</p>
              <ul className="space-y-2">
                {active.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 text-sm dark:bg-ink-800/60">
                    <span>
                      {s.mode === "DAILY" ? "Sesión diaria" : s.mode === "DOCUMENT" ? "Sesión de documento" : s.mode === "CUMULATIVE" ? "Repaso acumulativo" : "Práctica de concepto"} · {s.done}/{s.total} · {formatDate(s.lastActiveAt, true)}
                    </span>
                    <Link href={`/app/study/${s.id}`} className="font-medium text-accent-600 hover:underline">Continuar</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">Estado de tus conceptos</h2>
          {stats.totalConcepts === 0 ? (
            <p className="mt-2 text-sm text-ink-500">Aún no hay conceptos. Aparecerán al procesar un documento.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(["RELEARNING", "NEW", "LEARNING", "CONSOLIDATING", "MASTERED"] as const).map((k) => (
                <li key={k} className="flex items-center justify-between text-sm">
                  <Badge tone={MASTERY_LABEL[k]!.tone}>{MASTERY_LABEL[k]!.label}</Badge>
                  <span className="tabular-nums font-medium">{stats.byState[k]}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/stats" className="mt-4 inline-block text-sm text-accent-600 hover:underline">Ver progreso detallado →</Link>
        </Card>
      </div>

      {stats.illusions.length > 0 && (
        <div className="mt-4">
          <Alert tone="warning" title="Reconoces, pero no recuerdas">
            Respondes bien cuando ves opciones, pero te cuesta explicar sin ayuda: {stats.illusions.slice(0, 4).map((c) => c.name).join(", ")}. Tus próximas sesiones priorizarán la recuperación libre de estos conceptos.
          </Alert>
        </div>
      )}
      {review.length > 0 && (
        <div className="mt-4">
          <Alert tone="info" title="Informes de verificación pendientes">
            {review.map((d) => (
              <Link key={d.id} href={`/app/documents/${d.id}/verification`} className="mr-3 underline">{d.title}</Link>
            ))}
          </Alert>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Repasos vencidos" value={stats.dueNow} />
        <Stat label="Minutos hoy" value={stats.time.todayMinutes} hint={`${stats.time.weekMinutes} min en 7 días`} />
        <Stat label="Recuerdo libre" value={stats.freeRecall.avgScore === null ? "—" : `${Math.round(stats.freeRecall.avgScore * 100)}%`} hint={stats.freeRecall.n ? `media de ${stats.freeRecall.n} recuperaciones` : "sin datos aún"} />
        <Stat label="Con pistas" value={stats.hints.attempts ? `${Math.round((stats.hints.withHints / stats.hints.attempts) * 100)}%` : "—"} hint="de tus respuestas" />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Documentos recientes</h2>
      {docs.length === 0 ? (
        <EmptyState title="Tu biblioteca está vacía" action={<ButtonLink href="/app/library">Crear biblioteca y subir material</ButtonLink>}>
          Sube un PDF, DOCX, PPTX, TXT o una foto de tus apuntes para empezar.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {docs.slice(0, 6).map((d) => (
            <Link key={d.id} href={`/app/documents/${d.id}`} className="rounded-xl border border-ink-100 bg-white p-4 transition hover:border-accent-300 dark:border-ink-800 dark:bg-ink-900">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{d.title}</p>
                <Badge tone={DOC_STATUS[d.status]!.tone}>{DOC_STATUS[d.status]!.label}</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {d.libraryName} {d.isDemo && "· datos de demostración"}
              </p>
            </Link>
          ))}
        </div>
      )}
      {processing.length > 0 && <p className="mt-3 text-xs text-ink-500">{processing.length} documento(s) en procesamiento.</p>}
    </>
  );
}
