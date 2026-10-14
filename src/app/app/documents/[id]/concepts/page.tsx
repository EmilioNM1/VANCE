import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { withUser } from "@/db/client";
import { conceptMastery, sections } from "@/db/schema";
import { requireUser } from "@/server/auth/session";
import { getDocument } from "@/server/documents/service";
import { getDocumentKnowledge } from "@/server/knowledge/build";
import { loadOr404 } from "@/server/page-helpers";
import { Badge, Card, EmptyState, MASTERY_LABEL, PageHeader } from "@/components/ui";
import { StartSessionButton } from "@/components/start-session-button";
import { KIND_LABEL } from "@/lib/labels";

export const metadata = { title: "Conceptos" };
export const dynamic = "force-dynamic";


const REL_LABEL: Record<string, string> = {
  CAUSES: "causa",
  ENABLES: "permite",
  INHIBITS: "inhibe",
  PART_OF: "forma parte de",
  IS_A: "es un tipo de",
  PRECEDES: "precede a",
  PREREQUISITE_OF: "es prerrequisito de",
  REGULATES: "regula",
  CONTRASTS_WITH: "se distingue de",
  EXAMPLE_OF: "es ejemplo de",
  RELATED_TO: "se relaciona con",
};

export default async function ConceptsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const doc = await loadOr404(() => getDocument(user.id, id));
  const { concepts, relations } = await getDocumentKnowledge(user.id, id);
  const extra = await withUser(user.id, async (tx) => ({
    secs: await tx.select().from(sections).where(eq(sections.documentId, id)),
    mastery: concepts.length ? await tx.select().from(conceptMastery).where(and(eq(conceptMastery.userId, user.id), inArray(conceptMastery.conceptId, concepts.map((c) => c.id)))) : [],
  }));
  const mById = new Map(extra.mastery.map((m) => [m.conceptId, m]));
  const name = new Map(concepts.map((c) => [c.id, c.name]));
  const bySection = new Map<string, typeof concepts>();
  for (const c of concepts) bySection.set(c.sectionId ?? "", [...(bySection.get(c.sectionId ?? "") ?? []), c]);
  const sectionTitle = new Map(extra.secs.map((s) => [s.id, s.title]));

  return (
    <>
      <PageHeader
        back={{ href: `/app/documents/${id}`, label: doc.title }}
        title="Explorador de conceptos"
        subtitle="Estructura de conocimiento construida solo con afirmaciones validadas."
        actions={doc.status === "READY" ? <StartSessionButton mode="DOCUMENT" documentId={id}>Practicar este documento</StartSessionButton> : undefined}
      />
      {concepts.length === 0 ? (
        <EmptyState title="Todavía no hay conceptos">Se generan después de revisar el informe de verificación.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {[...bySection.entries()].map(([sid, list]) => (
              <section key={sid}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">{sectionTitle.get(sid) ?? "General"}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map((c) => {
                    const m = mById.get(c.id);
                    const st = MASTERY_LABEL[m?.state ?? "NEW"]!;
                    return (
                      <Link key={c.id} href={`/app/concepts/${c.id}`} className="rounded-xl border border-ink-100 bg-white p-4 transition hover:border-accent-300 dark:border-ink-800 dark:bg-ink-900">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{c.name}</p>
                          {c.importance >= 3 && <Badge tone="accent">central</Badge>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge>{KIND_LABEL[c.kind]}</Badge>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {m?.illusionFlag && <Badge tone="warning">reconoce sin recordar</Badge>}
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm text-ink-600 dark:text-ink-300">{c.summary}</p>
                        {c.details.steps && <p className="mt-1 text-xs text-ink-500">{c.details.steps.length} pasos</p>}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <Card className="h-fit">
            <h2 className="mb-3 font-semibold">Relaciones</h2>
            {relations.length === 0 ? (
              <p className="text-sm text-ink-500">No se identificaron relaciones respaldadas.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {relations.map((r) => (
                  <li key={r.id} className="rounded-lg bg-ink-50 px-3 py-2 dark:bg-ink-800/60">
                    <Link className="font-medium hover:underline" href={`/app/concepts/${r.fromConceptId}`}>{name.get(r.fromConceptId)}</Link>{" "}
                    <span className="text-ink-500">{REL_LABEL[r.type]}</span>{" "}
                    <Link className="font-medium hover:underline" href={`/app/concepts/${r.toConceptId}`}>{name.get(r.toConceptId)}</Link>
                    <p className="mt-0.5 text-xs text-ink-500">{r.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
