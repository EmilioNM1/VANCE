import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listLibraries } from "@/server/documents/service";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { CreateLibraryForm } from "@/components/library-client";

import { Page } from "@/components/page-container";

export const metadata = { title: "Biblioteca" };
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requireUser();
  const libs = await listLibraries(user.id);
  return (
    <Page wide>
      <PageHeader title="Biblioteca" subtitle="Organiza tu material por asignaturas, temas o proyectos." />
      <Card className="mb-6">
        <CreateLibraryForm />
      </Card>
      {libs.length === 0 ? (
        <EmptyState title="Aún no tienes bibliotecas">Crea una para empezar a subir libros, apuntes o presentaciones.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {libs.map((l) => (
            <Link key={l.id} href={`/app/library/${l.id}`} className="rounded-xl border border-line bg-surface p-5 transition hover:border-accent-300">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{l.name}</p>
                {l.isDemo && <Badge tone="warning">Demo</Badge>}
              </div>
              {l.subject && <p className="mt-0.5 text-sm text-muted">{l.subject}</p>}
              <p className="mt-3 text-xs text-muted">{l.documentCount} documento(s)</p>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
