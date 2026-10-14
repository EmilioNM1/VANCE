import { requireUser } from "@/server/auth/session";
import { StudySession } from "@/components/study/study-session";
import { Page } from "@/components/page-container";

export const metadata = { title: "Sesión de recuerdo" };

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return (
    <Page>
      <StudySession sessionId={id} />
    </Page>
  );
}
