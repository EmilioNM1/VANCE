import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listLibraries } from "@/server/documents/service";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { CreateLibraryForm } from "@/components/library-client";

export const metadata = { title: "Biblioteca" };
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requireUser();
  const libs = await listLibraries(user.id);
  return (
    <>
      <PageHeader title="Biblioteca" subtitle="Organiza tu material por asignaturas, temas o proyectos." />
      <Card className="mb-6">
        <CreateLibraryForm />
      </Card>
      {libs.length === 0 ? (
        <EmptyState title="Aún no tienes bibliotecas">Crea una para empezar a subir libros, apuntes o presentaciones.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {libs.map((l) => (
            <Link key={l.id} href={`/app/library/${l.id}`} className="rounded-2xl border border-ink-100 bg-white p-5 shadow-card transition hover:border-accent-300 dark:border-ink-800 dark:bg-ink-900">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{l.name}</p>
                {l.isDemo && <Badge tone="warning">Demo</Badge>}
              </div>
              {l.subject && <p className="mt-0.5 text-sm text-ink-500">{l.subject}</p>}
              <p className="mt-3 text-xs text-ink-500">{l.documentCount} documento(s)</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
