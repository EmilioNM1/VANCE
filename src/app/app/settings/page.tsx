import { requireUser } from "@/server/auth/session";
import { getProfile } from "@/server/account";
import { tokensUsedToday, aiConfigured, usageByOperation } from "@/server/ai";
import { geminiConfigured } from "@/server/retrieval/gemini";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, PageHeader } from "@/components/ui";
import { DeleteAccountForm, LearningSettingsForm, PasswordForm, ProfileForm } from "@/components/settings-client";

import { Page } from "@/components/page-container";

export const metadata = { title: "Ajustes" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const used = await tokensUsedToday(user.id);
  const usage = await usageByOperation(user.id, 30);
  const OP: Record<string, string> = {
    "audit.extract_claims": "Libros · afirmaciones",
    "audit.verify_claims": "Libros · verificación",
    "audit.contradictions": "Libros · contradicciones",
    "knowledge.build": "Libros · conocimiento",
    "activities.generate": "Generación de actividades",
    "evaluation.semantic": "Evaluación de respuestas",
    "notes.extract_claims": "Apuntes · afirmaciones",
    "notes.compare": "Apuntes · contraste con libros",
    "notes.build_knowledge": "Apuntes · conceptos",
    "retrieval.gemini_file_search": "Búsqueda semántica (Gemini)",
    "document.ocr": "OCR",
  };
  const budget = Number(process.env.AI_DAILY_TOKEN_BUDGET_PER_USER ?? 0);
  return (
    <Page wide>
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
        <Card className="lg:col-span-2">
          <h2 className="mb-1 font-semibold">Apariencia</h2>
          <p className="mb-3 text-sm text-muted">Se recuerda en este dispositivo.</p>
          <ThemeToggle />
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-1 font-semibold">Consumo de IA (últimos 30 días)</h2>
          <p className="mb-3 text-sm text-muted">
            La IA solo se usa cuando la pides (analizar, crear preguntas, evaluar respuestas abiertas). Los resultados repetidos se reutilizan desde la caché sin coste.
            {geminiConfigured() ? " La búsqueda semántica en libros usa Gemini File Search." : " La búsqueda en libros usa el índice de texto completo local (sin coste)."}
          </p>
          {usage.length === 0 ? (
            <p className="text-sm text-muted">Sin consumo registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 font-medium">Operación</th>
                    <th className="font-medium">Llamadas</th>
                    <th className="font-medium">Tokens de entrada</th>
                    <th className="font-medium">Tokens de salida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {usage.map((u) => (
                    <tr key={u.operation}>
                      <td className="py-1.5">{u.operation.endsWith(":cache") ? `${OP[u.operation.replace(":cache", "")] ?? u.operation.replace(":cache", "")} · desde caché` : OP[u.operation] ?? u.operation}</td>
                      <td>{u.calls}</td>
                      <td>{u.inputTokens.toLocaleString("es-ES")}</td>
                      <td>{u.outputTokens.toLocaleString("es-ES")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Uso de IA</h2>
          <p className="text-sm text-muted">
            {aiConfigured() ? `Últimas 24 h: ${used.toLocaleString("es-ES")} tokens${budget ? ` de ${budget.toLocaleString("es-ES")} permitidos` : ""}.` : "La IA no está configurada en este servidor."}
          </p>
          <p className="mt-2 text-xs text-muted">El contenido de tus documentos y tus respuestas se envía al proveedor de IA (Anthropic) para analizarlo y evaluarlo, según sus condiciones de uso de la API.</p>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Tus datos</h2>
          <p className="mb-3 text-sm text-muted">Descarga una copia de tus datos (sin los archivos originales).</p>
          <a href="/api/account/export" className="inline-flex rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-sunken dark:hover:bg-ink-800">Exportar datos (JSON)</a>
        </Card>
        <Card className="border-rose-200 lg:col-span-2 dark:border-rose-900">
          <h2 className="mb-2 font-semibold text-rose-700 dark:text-rose-300">Eliminar cuenta</h2>
          <DeleteAccountForm />
        </Card>
      </div>
    </Page>
  );
}
