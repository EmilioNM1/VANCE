import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui";

const steps = [
  { t: "Sube tu material", d: "PDF, DOCX, presentaciones, apuntes en texto o fotos. Se conserva la página y el fragmento de origen de cada idea." },
  { t: "Verificación científica", d: "La IA identifica afirmaciones, las contrasta con PubMed y búsqueda web y te propone correcciones con fuentes comprobables. Tú decides." },
  { t: "Mapa de conocimiento", d: "Conceptos, procesos, mecanismos, causas y prerrequisitos conectados entre sí, construidos solo con información validada." },
  { t: "Recuerdo activo", d: "Explica de memoria, reconstruye procesos, predice consecuencias y resuelve casos nuevos. Sin ver la respuesta antes de intentarlo." },
  { t: "Corrección adaptativa", d: "Pistas progresivas según tu error, nueva oportunidad, explicación y nueva recuperación. Tus errores conceptuales se recuerdan." },
  { t: "Memoria a largo plazo", d: "Repasos espaciados personalizados que distinguen lo que reconoces de lo que realmente puedes recordar días después." },
];

export default async function Landing() {
  if (await getCurrentUser()) redirect("/app");
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-ink-50 dark:from-ink-950 dark:to-ink-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo className="text-lg text-ink-900 dark:text-white" />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white">
            Iniciar sesión
          </Link>
          <ButtonLink href="/register">Crear cuenta</ButtonLink>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="py-16 text-center sm:py-24">
          <p className="mb-4 inline-block rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent-800 dark:bg-accent-900/50 dark:text-accent-200">
            Entrenador personal de memoria
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl dark:text-white">
            No memorices respuestas. <span className="text-accent-600 dark:text-accent-400">Aprende a recuperar</span> lo que estudias.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
            VANCE transforma tus libros y apuntes en entrenamiento de recuerdo activo: verifica el contenido, organiza el conocimiento, corrige tus errores y programa repasos para que lo recuerdes semanas después.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/register" className="px-6 py-3 text-base">
              Empezar gratis
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" className="px-6 py-3 text-base">
              Ya tengo cuenta
            </ButtonLink>
          </div>
        </section>
        <section className="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.t} className="rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
              <span className="text-sm font-semibold text-accent-600 dark:text-accent-400">0{i + 1}</span>
              <h2 className="mt-1 font-semibold text-ink-900 dark:text-white">{s.t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{s.d}</p>
            </div>
          ))}
        </section>
        <section className="mb-20 rounded-2xl bg-ink-900 p-8 text-ink-100 dark:bg-ink-800">
          <h2 className="text-xl font-semibold text-white">Ejemplo: fisiología muscular</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-300">
            En lugar de preguntarte «¿qué es la troponina?», VANCE te pide reconstruir el acoplamiento excitación-contracción desde la acetilcolina hasta la interacción actina-miosina, predecir qué pasaría si se bloquea la liberación de calcio del retículo sarcoplásmico y explicarlo de nuevo varios días después.
          </p>
          <p className="mt-4 text-xs text-ink-400">
            Las estadísticas de VANCE reflejan tu rendimiento observado en las actividades; no miden directamente la memoria biológica.
          </p>
        </section>
      </main>
      <footer className="border-t border-ink-100 py-6 text-center text-xs text-ink-500 dark:border-ink-800">
        Tus documentos son privados. Sube solo material que tengas derecho a usar para tu estudio personal.
      </footer>
    </div>
  );
}
