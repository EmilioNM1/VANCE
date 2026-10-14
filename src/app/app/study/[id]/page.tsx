import { requireUser } from "@/server/auth/session";
import { StudySession } from "@/components/study/study-session";

export const metadata = { title: "Sesión de recuerdo" };

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  return <StudySession sessionId={id} />;
}
