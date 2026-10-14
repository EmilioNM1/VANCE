import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listNotebooks } from "@/server/notebooks/service";
import { NOTEBOOK_DOT } from "@/lib/labels";
import { EmptyState, PageHeader, relativeTime } from "@/components/ui";
import { Page } from "@/components/page-container";
import { NewNotebookInline } from "@/components/notebooks/quick-actions";
import { NotesSearch } from "@/components/notebooks/notes-search";

export const metadata = { title: "Cuadernos" };
export const dynamic = "force-dynamic";

export default async function NotebooksPage() {
  const user = await requireUser();
  const notebooks = await listNotebooks(user.id);
  return (
    <Page wide>
      <PageHeader title="Cuadernos" subtitle="Tus apuntes por asignatura. Cada página puede conectarse con tus libros y convertirse en repasos." />
      <div className="mb-8 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <NewNotebookInline />
        <NotesSearch />
      </div>
      {notebooks.length === 0 ? (
        <EmptyState icon={<NotebookPen className="h-5 w-5" />} title="Todavía no tienes cuadernos">
          Crea uno por asignatura (Fisiología, Anatomía, Bioquímica…). Se abrirá directamente una página para empezar a escribir.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((n) => (
            <li key={n.id}>
              <Link href={`/app/notebooks/${n.id}`} className="group flex h-full gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent-300">
                <span className={`w-1.5 shrink-0 rounded-full ${NOTEBOOK_DOT[n.color] ?? NOTEBOOK_DOT.teal}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-lg font-semibold group-hover:text-accent-700">{n.title}</span>
                  {n.subject && <span className="block truncate text-sm text-muted">{n.subject}</span>}
                  <span className="mt-3 block text-xs text-muted">
                    {n.pageCount} página{n.pageCount === 1 ? "" : "s"}
                    {n.lastEdited ? ` · editado ${relativeTime(n.lastEdited)}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
