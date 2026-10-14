import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getAgenda, getDashboardStats } from "@/server/analytics/stats";
import { Badge, Card, EmptyState, MASTERY_LABEL, PageHeader, formatDate, relativeDue } from "@/components/ui";
import { StartSessionButton } from "@/components/start-session-button";

import { Page } from "@/components/page-container";

export const metadata = { title: "Repasos" };
export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await requireUser();
  const [agenda, stats] = await Promise.all([getAgenda(user.id), getDashboardStats(user.id)]);
  const groups = [
    { key: "overdue", title: "Pendientes ahora", items: agenda.filter((a) => a.overdue) },
    { key: "relearn", title: "Olvidados: recuperar", items: agenda.filter((a) => !a.overdue && a.state === "RELEARNING") },
    { key: "learning", title: "En proceso de consolidación", items: agenda.filter((a) => !a.overdue && (a.state === "LEARNING" || a.state === "CONSOLIDATING")) },
    { key: "mastered", title: "Parecen dominados (se seguirán comprobando)", items: agenda.filter((a) => !a.overdue && a.state === "MASTERED") },
  ];
  const maxDay = Math.max(1, ...stats.upcoming.map((u) => u.count));
  return (
    <Page wide>
      <PageHeader
        title="Agenda de repasos"
        subtitle="Cada concepto vuelve cuando la probabilidad estimada de recordarlo empieza a bajar."
        actions={
          agenda.length > 0 ? (
            <>
              <StartSessionButton mode="DAILY">Sesión diaria</StartSessionButton>
              <StartSessionButton mode="CUMULATIVE" variant="secondary">Repaso acumulativo</StartSessionButton>
            </>
          ) : undefined
        }
      />
      {agenda.length === 0 ? (
        <EmptyState title="Aún no hay repasos programados">Los conceptos entran en la agenda después de practicarlos por primera vez.</EmptyState>
      ) : (
        <>
          <Card className="mb-6">
            <h2 className="mb-3 font-semibold">Próximos 7 días</h2>
            <div className="flex h-32 items-end gap-2" role="img" aria-label={`Repasos por día: ${stats.upcoming.map((u) => `${u.date}: ${u.count}`).join(", ")}`}>
              {stats.upcoming.map((u, i) => (
                <div key={u.date} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs tabular-nums text-muted">{u.count}</span>
                  <div className="w-full rounded-t-md bg-accent-500/80" style={{ height: `${(u.count / maxDay) * 80 + 2}px` }} />
                  <span className="text-[11px] text-muted">{i === 0 ? "Hoy" : new Date(u.date).toLocaleDateString("es-ES", { weekday: "short" })}</span>
                </div>
              ))}
            </div>
          </Card>
          <div className="space-y-6">
            {groups.map((g) =>
              g.items.length ? (
                <section key={g.key}>
                  <h2 className="mb-2 font-semibold">{g.title} <span className="text-muted">({g.items.length})</span></h2>
                  <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                    {g.items.map((a) => (
                      <li key={a.conceptId} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <Link href={`/app/concepts/${a.conceptId}`} className="font-medium hover:underline">{a.name}</Link>
                          <p className="text-xs text-muted">{a.documentTitle} · último repaso {formatDate(a.lastReviewedAt)}</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {a.illusion && <Badge tone="warning">reconoce sin recordar</Badge>}
                          <Badge tone={MASTERY_LABEL[a.state]!.tone}>{MASTERY_LABEL[a.state]!.label}</Badge>
                          <span className="tabular-nums text-muted">{relativeDue(a.dueAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null,
            )}
          </div>
        </>
      )}
    </Page>
  );
}
