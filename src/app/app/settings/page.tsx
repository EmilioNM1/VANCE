import { requireUser } from "@/server/auth/session";
import { getProfile } from "@/server/account";
import { tokensUsedToday, aiConfigured } from "@/server/ai";
import { Card, PageHeader } from "@/components/ui";
import { DeleteAccountForm, LearningSettingsForm, PasswordForm, ProfileForm } from "@/components/settings-client";

export const metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const used = await tokensUsedToday(user.id);
  const budget = Number(process.env.AI_DAILY_TOKEN_BUDGET_PER_USER ?? 0);
  return (
    <>
      <PageHeader title="Ajustes" subtitle={profile.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Perfil</h2>
          <ProfileForm name={profile.name} />
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Contraseña</h2>
          <PasswordForm />
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Aprendizaje y repasos</h2>
          <LearningSettingsForm settings={profile.settings} />
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Uso de IA</h2>
          <p className="text-sm text-ink-600 dark:text-ink-300">
            {aiConfigured() ? `Últimas 24 h: ${used.toLocaleString("es-ES")} tokens${budget ? ` de ${budget.toLocaleString("es-ES")} permitidos` : ""}.` : "La IA no está configurada en este servidor."}
          </p>
          <p className="mt-2 text-xs text-ink-500">El contenido de tus documentos y tus respuestas se envía al proveedor de IA (Anthropic) para analizarlo y evaluarlo, según sus condiciones de uso de la API.</p>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Tus datos</h2>
          <p className="mb-3 text-sm text-ink-600 dark:text-ink-300">Descarga una copia de tus datos (sin los archivos originales).</p>
          <a href="/api/account/export" className="inline-flex rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800">Exportar datos (JSON)</a>
        </Card>
        <Card className="border-rose-200 lg:col-span-2 dark:border-rose-900">
          <h2 className="mb-2 font-semibold text-rose-700 dark:text-rose-300">Eliminar cuenta</h2>
          <DeleteAccountForm />
        </Card>
      </div>
    </>
  );
}
