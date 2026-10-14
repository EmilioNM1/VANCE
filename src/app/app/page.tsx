import Link from "next/link";
import { ArrowRight, BookOpen, Brain, ChevronRight, NotebookPen, Sparkles } from "lucide-react";
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

/** Lista agrupada (estilo iOS): un solo bloque con separadores, cómoda de tocar. */
const GROUP = "overflow-hidden rounded-2xl border border-line bg-surface shadow-card divide-y divide-line";
const ROW = "flex min-h-[3.5rem] items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken/60 active:bg-sunken";

export default async function Home() {
  const user = await requireUser();
  const [due, active, docs, pages, agenda, notebooks] = await Promise.all([
    dueCount(user.id),
    listActiveSessions(user.id),
    listDocuments(user.id),
    recentPages(user.id, 5),
    getAgenda(user.id),
    listNotebooks(user.id),
  ]);
  const resume = active[0];
  const toReview = agenda.filter((a) => a.overdue).slice(0, 4);
  const pending = due.due + due.fresh;
  const hasStudyMaterial = pending > 0 || agenda.length > 0;

  const hero = resume
    ? { title: "Continúa donde lo dejaste", sub: `Sesión en curso · ${resume.done} de ${resume.total} actividades` }
    : pending > 0
      ? {
          title: due.due > 0 ? "Hora de repasar" : "Practica lo nuevo",
          sub: [due.due && `${due.due} por repasar`, due.fresh && `${due.fresh} nuevo${due.fresh === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
        }
      : hasStudyMaterial
        ? { title: "Todo al día", sub: "Un repaso rápido mantiene vivo lo aprendido." }
        : { title: "Empieza a construir tu memoria", sub: "Escribe tus apuntes o sube un libro y VANCE lo convertirá en práctica." };

  const shortcuts = [
    { href: "/app/notebooks", icon: NotebookPen, title: "Cuadernos", sub: notebooks.length ? `${notebooks.length}` : "Crear", tint: "bg-accent-100 text-accent-700 dark:bg-accent-900/60 dark:text-accent-200" },
    { href: "/app/reviews", icon: Brain, title: "Repasos", sub: due.due ? `${due.due} hoy` : "Al día", tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200" },
    { href: "/app/library", icon: BookOpen, title: "Libros", sub: docs.length ? `${docs.length}` : "Subir", tint: "bg-coral-100 text-coral-700 dark:bg-coral-900/50 dark:text-coral-200" },
  ];

  return (
    <Page wide>
      <header className="mb-6 sm:mb-8">
        <p className="text-sm text-muted first-letter:uppercase">{new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="title-serif mt-1 text-[1.85rem] leading-tight sm:text-[2.4rem]">
          {greeting()}, {user.name.split(" ")[0]}
        </h1>
      </header>

      {/* Acción principal: el único bloque de color intenso de la pantalla */}
      <section aria-labelledby="continuar" className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-accent-500 via-accent-600 to-accent-800 p-6 text-white shadow-glow sm:mb-8 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-coral-400/40 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-accent-300/30 blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" /> Tu sesión de hoy
            </p>
            <h2 id="continuar" className="title-serif text-[1.6rem] leading-tight sm:text-[1.9rem]">
              {hero.title}
            </h2>
            <p className="mt-1.5 text-[15px] text-white/80">{hero.sub}</p>
          </div>
          {resume ? (
            <Link href={`/app/study/${resume.id}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 font-semibold text-accent-700 shadow-sm transition hover:bg-accent-50 sm:min-w-[11rem]">
              Continuar <ArrowRight className="h-4 w-4" />
            </Link>
          ) : hasStudyMaterial ? (
            <StartSessionButton mode={pending > 0 ? "DAILY" : "CUMULATIVE"} variant="inverse" size="lg" className="w-full font-semibold sm:w-auto sm:min-w-[11rem]">
              {pending > 0 ? "Empezar" : "Repaso rápido"}
            </StartSessionButton>
          ) : (
            <QuickPageButton variant="inverse" className="w-full font-semibold sm:w-auto" />
          )}
        </div>
      </section>

      {/* Tres accesos, siempre en una fila */}
      <nav aria-label="Accesos" className="mb-10 grid grid-cols-3 gap-3 sm:gap-4">
        {shortcuts.map(({ href, icon: Icon, title, sub, tint }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-card transition hover:-translate-y-0.5 hover:shadow-float active:translate-y-0 sm:flex-row sm:items-center sm:p-5"
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tint}`}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">{title}</span>
              <span className="block truncate text-[13px] text-muted">{sub}</span>
            </span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-12">
        <section aria-labelledby="paginas">
          <SectionTitle action={<QuickPageButton variant="quiet" />}>
            <span id="paginas">Páginas recientes</span>
          </SectionTitle>
          {pages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface/60 p-5">
              <p className="text-[15px]">Crea tu primer cuaderno, por ejemplo «Fisiología».</p>
              <div className="mt-4">
                <NewNotebookInline />
              </div>
            </div>
          ) : (
            <ul className={GROUP}>
              {pages.map((p, i) => (
                <li key={p.id} className={i >= 4 ? "hidden sm:block" : undefined}>
                  <Link href={`/app/notebooks/page/${p.id}`} className={ROW}>
                    <span className={`h-9 w-1.5 shrink-0 rounded-full ${NOTEBOOK_DOT[p.notebookColor] ?? NOTEBOOK_DOT.teal}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{p.title}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {p.notebookTitle} · {relativeTime(p.updatedAt)}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted/70" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-10">
          <section aria-labelledby="recordar">
            <SectionTitle action={<Link href="/app/reviews" className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-300">Ver agenda</Link>}>
              <span id="recordar">Para recordar hoy</span>
            </SectionTitle>
            {toReview.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface px-4 py-4 text-[15px] text-muted shadow-card">No hay conceptos vencidos. ¡Buen trabajo!</p>
            ) : (
              <ul className={GROUP}>
                {toReview.map((a) => (
                  <li key={a.conceptId}>
                    <Link href={`/app/concepts/${a.conceptId}`} className={ROW}>
                      <span className="h-2 w-2 shrink-0 rounded-full bg-coral-500" />
                      <span className="min-w-0 flex-1 truncate text-[15px]">{a.name}</span>
                      <span className="shrink-0 text-xs text-muted">{relativeDue(a.dueAt)}</span>
                    </Link>
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
              <p className="rounded-2xl border border-line bg-surface px-4 py-4 text-[15px] text-muted shadow-card">
                <Link href="/app/library" className="font-medium text-accent-700 hover:underline dark:text-accent-300">
                  Sube un libro
                </Link>{" "}
                para contrastar tus apuntes con él.
              </p>
            ) : (
              <ul className={GROUP}>
                {docs.slice(0, 3).map((d) => (
                  <li key={d.id}>
                    <Link href={`/app/documents/${d.id}`} className={ROW}>
                      <BookOpen className="h-[18px] w-[18px] shrink-0 text-coral-500" />
                      <span className="min-w-0 flex-1 truncate text-[15px]">{d.title}</span>
                      {d.status !== "READY" && <Badge tone={DOC_STATUS[d.status]!.tone}>{DOC_STATUS[d.status]!.label}</Badge>}
                    </Link>
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
