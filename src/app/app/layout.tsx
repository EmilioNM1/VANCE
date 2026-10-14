import { requireUser } from "@/server/auth/session";
import { AppShell } from "@/components/app-nav";
import { listNotebooks } from "@/server/notebooks/service";
import { dueCount } from "@/server/study/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [notebooks, due] = await Promise.all([listNotebooks(user.id), dueCount(user.id)]);
  return (
    <AppShell userName={user.name} notebooks={notebooks.map((n) => ({ id: n.id, title: n.title, color: n.color }))} due={due.due}>
      {children}
    </AppShell>
  );
}
