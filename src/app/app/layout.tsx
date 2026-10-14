import { requireUser } from "@/server/auth/session";
import { AppNav } from "@/components/app-nav";
import { aiConfigured } from "@/server/ai";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <AppNav userName={user.name} />
      <div className="lg:pl-60">
        {!aiConfigured() && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
            IA no configurada (falta ANTHROPIC_API_KEY): se puede extraer texto y practicar actividades existentes, pero el análisis, la verificación y la evaluación de respuestas abiertas quedan pendientes o en modo provisional.
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:pb-10 lg:pt-10">{children}</main>
      </div>
    </div>
  );
}
