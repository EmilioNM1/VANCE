import Link from "next/link";
import { FileText } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getNotebookTree } from "@/server/notebooks/service";
import { loadOr404 } from "@/server/page-helpers";
import { NOTEBOOK_DOT } from "@/lib/labels";
import { relativeTime } from "@/components/ui";
import { Page } from "@/components/page-container";
import { NotebookTree } from "@/components/notebooks/notebook-tree";
import { NotebookActions } from "@/components/notebooks/notebook-actions";
import { StartSessionButton } from "@/components/start-session-button";

export const dynamic = "force-dynamic";

export default async function NotebookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { notebook, sections } = await loadOr404(() => getNotebookTree(user.id, id));
  const tree = sections.map((s) => ({ id: s.id, title: s.title, ord: s.ord, pages: s.pages.map((p) => ({ id: p.id, title: p.title, ord: p.ord })) }));
  return (
    <Page wide>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/app/notebooks" className="mb-2 inline-block text-sm text-muted hover:text-accent-700">
            ← Cuadernos
          </Link>
          <h1 className="title-serif flex items-center gap-3 text-[2rem] leading-tight">
            <span className={`h-3 w-3 rounded-full ${NOTEBOOK_DOT[notebook.color] ?? NOTEBOOK_DOT.teal}`} />
            {notebook.title}
          </h1>
          {notebook.subject && <p className="mt-1 text-muted">{notebook.subject}</p>}
        </div>
        <NotebookActions notebook={{ id: notebook.id, title: notebook.title, color: notebook.color, subject: notebook.subject }} />
      </div>
      <div className="grid gap-10 lg:grid-cols-[18rem_1fr]">
        <aside className="hidden rounded-2xl border border-line bg-surface shadow-card py-3 lg:block">
          <NotebookTree notebook={{ id: notebook.id, title: notebook.title, color: notebook.color }} sections={tree} />
        </aside>
        <div className="space-y-10">
          {sections.map((s) => (
            <section key={s.id}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="title-serif text-xl">{s.title}</h2>
                {s.pages.length > 0 && (
                  <StartSessionButton mode="SECTION" notebookSectionId={s.id} variant="quiet" size="sm">
                    Repasar sección
                  </StartSessionButton>
                )}
              </div>
              {s.pages.length === 0 ? (
                <p className="text-sm text-muted">Sin páginas todavía.</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {s.pages.map((p) => (
                    <li key={p.id}>
                      <Link href={`/app/notebooks/page/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface/60">
                        <FileText className="h-4 w-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate font-serif text-[16px]">{p.title}</span>
                        <span className="shrink-0 text-xs text-muted">
                          <span className="hidden sm:inline">{p.wordCount} palabras · </span>
                          {relativeTime(p.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <div className="rounded-2xl border border-line bg-surface shadow-card py-3 lg:hidden">
            <p className="px-4 pb-1 text-xs font-medium uppercase tracking-wider text-muted">Organizar secciones y páginas</p>
            <NotebookTree notebook={{ id: notebook.id, title: notebook.title, color: notebook.color }} sections={tree} />
          </div>
        </div>
      </div>
    </Page>
  );
}
