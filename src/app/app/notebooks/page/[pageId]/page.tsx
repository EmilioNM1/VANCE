import { requireUser } from "@/server/auth/session";
import { getNotebookTree, getPage } from "@/server/notebooks/service";
import { listDocuments } from "@/server/documents/service";
import { loadOr404 } from "@/server/page-helpers";
import { aiConfigured } from "@/server/ai";
import { geminiConfigured } from "@/server/retrieval/gemini";
import { NoteWorkspace } from "@/components/notebooks/workspace";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ pageId: string }> }) {
  const user = await requireUser();
  const { pageId } = await params;
  const p = await getPage(user.id, pageId).catch(() => null);
  return { title: p?.page.title ?? "Página" };
}

export default async function NotePage({ params }: { params: Promise<{ pageId: string }> }) {
  const user = await requireUser();
  const { pageId } = await params;
  const data = await loadOr404(() => getPage(user.id, pageId));
  const [tree, docs] = await Promise.all([getNotebookTree(user.id, data.notebook.id), listDocuments(user.id)]);
  const p = data.page;
  return (
    <NoteWorkspace
      key={p.id}
      page={{ id: p.id, title: p.title, content: p.content, version: p.version, contentHash: p.contentHash, lastAnalyzedHash: p.lastAnalyzedHash, wordCount: p.wordCount, updatedAt: p.updatedAt.toISOString() }}
      notebook={{ id: data.notebook.id, title: data.notebook.title, color: data.notebook.color }}
      section={{ id: data.section.id, title: data.section.title }}
      tree={tree.sections.map((s) => ({ id: s.id, title: s.title, ord: s.ord, pages: s.pages.map((x) => ({ id: x.id, title: x.title, ord: x.ord })) }))}
      linkedDocuments={data.linkedDocuments}
      allDocuments={docs.filter((d) => !d.isDemo || true).map((d) => ({ id: d.id, title: d.title }))}
      conceptCount={data.conceptCount}
      aiEnabled={aiConfigured()}
      geminiEnabled={geminiConfigured()}
    />
  );
}
