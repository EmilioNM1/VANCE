import Link from "next/link";
import { ArrowRight, BookOpen, Brain, NotebookPen, Play } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { dueCount, listActiveSessions } from "@/server/study/session";
import { getAgenda } from "@/server/analytics/stats";
import { listDocuments } from "@/server/documents/service";
import { listNotebooks, recentPages } from "@/server/notebooks/service";
import { aiConfigured } from "@/server/ai";
import { Badge, DOC_STATUS, SectionTitle, relativeDue, relativeTime } from "@/components/ui";
import { Page } from "@/components/page-container";
import { StartSessionButton } from "@/components/start-session-button";
import { NewNotebookInline, QuickPageButton } from "@/components/notebooks/quick-actions";
import { NOTEBOOK_DOT } from "@/lib/labels";

export const metadata = { title: "Inicio" };
export const dynamic = "force-dynamic";

function greeting() {
  const h = new Date().getHours();
  return h < 13 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

export default async function Home() {
  const user = await requireUser();
  const [due, active, docs, pages, agenda, notebooks] = await Promise.all([
    dueCount(user.id),
    listActiveSessions(user.id),
    listDocuments(user.id),
    recentPages(user.id, 6),
    getAgenda(user.id),
    listNotebooks(user.id),
  ]);
  const resume = active[0];
  const toReview = agenda.filter((a) => a.overdue).slice(0, 6);
  const hasStudyMaterial = due.due + due.fresh > 0 || agenda.length > 0;

  return (
    <Page wide>
      <header className="mb-10">
        <p className="text-sm text-muted">{new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="title-serif mt-1 text-[2rem] leading-tight sm:text-[2.4rem]">
          {greeting()}, {user.name.split(" ")[0]}.
        </h1>
      </header>

      {/* Acción principal: continuar estudiando */}
      <section aria-labelledby="continuar" className="mb-10 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700 dark:bg-accent-900/50 dark:text-accent-300">
              <Play className="h-5 w-5" />
            </span>
            <div>
              <h2 id="continuar" className="title-serif text-xl">
                {resume ? "Continúa donde lo dejaste" : due.due > 0 ? "Tienes repasos pendientes" : hasStudyMaterial ? "Sesión de hoy" : "Empieza a construir tu memoria"}
              </h2>
              <p className="mt-1 text-[15px] text-muted">
                {resume
                  ? `Sesión en curso · ${resume.done} de ${resume.total} actividades`
                  : due.due + due.fresh > 0
                    ? `${due.due ? `${due.due} concepto${due.due === 1 ? "" : "s"} por repasar` : ""}${due.due && due.fresh ? " · " : ""}${due.fresh ? `${due.fresh} nuevo${due.fresh === 1 ? "" : "s"} por practicar` : ""}`
                    : hasStudyMaterial
                      ? "Nada vence hoy. Un repaso acumulativo mantiene vivo lo aprendido."
                      : "Escribe tus apuntes o sube un libro; VANCE los convertirá en práctica de recuerdo activo."}
              </p>
            </div>
          </div>
          {resume ? (
            <Link href={`/app/study/${resume.id}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent-600 px-5 font-medium text-white hover:bg-accent-700 dark:bg-accent-500 dark:text-ink-950">
              Continuar <ArrowRight className="h-4 w-4" />
            </Link>
          ) : hasStudyMaterial ? (
            <StartSessionButton mode={due.due + due.fresh > 0 ? "DAILY" : "CUMULATIVE"}>{due.due + due.fresh > 0 ? "Empezar sesión" : "Repaso acumulativo"}</StartSessionButton>
          ) : (
            <QuickPageButton />
          )}
        </div>
      </section>

      {/* Tres accesos secundarios, sin ruido */}
      <nav aria-label="Accesos" className="mb-12 grid gap-2 sm:grid-cols-3">
        {[
          { href: "/app/notebooks", icon: NotebookPen, title: "Mis cuadernos", sub: notebooks.length ? `${notebooks.length} cuaderno${notebooks.length === 1 ? "" : "s"}` : "Crea el primero" },
          { href: "/app/library", icon: BookOpen, title: "Mis libros", sub: docs.length ? `${docs.length} documento${docs.length === 1 ? "" : "s"}` : "Sube un PDF o DOCX" },
          { href: "/app/reviews", icon: Brain, title: "Lo que debo recordar", sub: due.due ? `${due.due} pendiente${due.due === 1 ? "" : "s"} hoy` : "Al día" },
        ].map(({ href, icon: Icon, title, sub }) => (
          <Link key={href} href={href} className="group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-surface">
            <Icon className="h-5 w-5 text-muted group-hover:text-accent-600" strokeWidth={1.7} />
            <span className="flex-1">
              <span className="block text-[15px] font-medium">{title}</span>
              <span className="block text-sm text-muted">{sub}</span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted opacity-0 transition group-hover:opacity-100" />
          </Link>
        ))}
      </nav>

      <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
        <section aria-labelledby="paginas">
          <SectionTitle action={<QuickPageButton variant="quiet" />}>
            <span id="paginas">Páginas recientes</span>
          </SectionTitle>
          {pages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-6">
              <p className="text-[15px]">Crea tu primer cuaderno, por ejemplo «Fisiología».</p>
              <div className="mt-4">
                <NewNotebookInline />
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {pages.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/notebooks/page/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface/60">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${NOTEBOOK_DOT[p.notebookColor] ?? NOTEBOOK_DOT.teal}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[16px] font-medium">{p.title}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {p.notebookTitle} · {p.sectionTitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{relativeTime(p.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-12">
          <section aria-labelledby="recordar">
            <SectionTitle action={toReview.length ? <Link href="/app/reviews" className="text-sm text-accent-700 hover:underline dark:text-accent-300">Agenda</Link> : undefined}>
              <span id="recordar">Para recordar hoy</span>
            </SectionTitle>
            {toReview.length === 0 ? (
              <p className="text-[15px] text-muted">No hay conceptos vencidos.</p>
            ) : (
              <ul className="space-y-2">
                {toReview.map((a) => (
                  <li key={a.conceptId} className="flex items-baseline justify-between gap-3">
                    <Link href={`/app/concepts/${a.conceptId}`} className="truncate text-[15px] hover:text-accent-700">
                      {a.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted">{relativeDue(a.dueAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="libros">
            <SectionTitle>
              <span id="libros">Libros recientes</span>
            </SectionTitle>
            {docs.length === 0 ? (
              <p className="text-[15px] text-muted">
                <Link href="/app/library" className="text-accent-700 hover:underline dark:text-accent-300">
                  Sube un libro
                </Link>{" "}
                para contrastar tus apuntes con él.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {docs.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3">
                    <Link href={`/app/documents/${d.id}`} className="truncate text-[15px] hover:text-accent-700">
                      {d.title}
                    </Link>
                    {d.status !== "READY" && <Badge tone={DOC_STATUS[d.status]!.tone}>{DOC_STATUS[d.status]!.label}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!aiConfigured() && (
            <p className="text-xs leading-relaxed text-muted">
              La IA no está configurada en este servidor: puedes escribir, organizar, exportar y practicar actividades existentes; el análisis de apuntes y libros requiere configurar la clave del proveedor.
            </p>
          )}
        </div>
      </div>
    </Page>
  );
}
