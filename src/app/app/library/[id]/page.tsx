import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getLibrary } from "@/server/documents/service";
import { loadOr404 } from "@/server/page-helpers";
import { Badge, Card, DOC_STATUS, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { DangerButton, UploadForm } from "@/components/library-client";

import { Page } from "@/components/page-container";

export const dynamic = "force-dynamic";

export default async function LibraryDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await loadOr404(() => getLibrary(user.id, id));
  const { library, documents } = data;
  return (
    <Page wide>
      <PageHeader
        back={{ href: "/app/library", label: "Biblioteca" }}
        title={library.name}
        subtitle={library.subject ?? undefined}
        actions={<DangerButton url={`/api/libraries/${library.id}`} label="Eliminar biblioteca" confirmText="Se eliminarán la biblioteca, sus documentos y todo el progreso asociado. ¿Continuar?" redirectTo="/app/library" />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <h2 className="mb-3 font-semibold">Documentos</h2>
          {documents.length === 0 ? (
            <EmptyState title="Sin documentos">Sube tu primer material con el formulario.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/documents/${d.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-accent-300">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.title}</p>
                      <p className="text-xs text-muted">
                        {d.originalFilename} · {formatDate(d.createdAt)} {d.pageCount ? `· ${d.pageCount} págs.` : ""}
                      </p>
                    </div>
                    <Badge tone={DOC_STATUS[d.status]!.tone}>{DOC_STATUS[d.status]!.label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card>
          <h2 className="mb-3 font-semibold">Subir material</h2>
          <UploadForm libraryId={library.id} maxMb={Number(process.env.MAX_UPLOAD_MB ?? 25)} />
        </Card>
      </div>
    </Page>
  );
}
