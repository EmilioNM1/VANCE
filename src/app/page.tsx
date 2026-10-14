import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui";

const steps = [
  { t: "Escribe tus apuntes", d: "Cuadernos por asignatura, secciones y páginas, en un editor cómodo como un procesador de textos, guardado en la nube." },
  { t: "Conéctalos con tus libros", d: "Consulta el libro sin salir de la página y contrasta lo que escribiste: errores, omisiones y correcciones con su página de origen." },
  { t: "Conocimiento verificado", d: "Solo lo respaldado por tus fuentes (o aprobado por ti) se convierte en material de estudio. Nada de memorizar errores." },
  { t: "Recuerdo activo", d: "Explica con tus palabras, reconstruye mecanismos, completa esquemas, relaciona conceptos y resuelve casos nuevos." },
  { t: "Corrección que enseña", d: "Pistas progresivas según tu error, nueva oportunidad, explicación y nueva recuperación. Tus errores se recuerdan." },
  { t: "Memoria a largo plazo", d: "Repasos espaciados que distinguen lo que reconoces de lo que de verdad recuerdas días después." },
];

export default async function Landing() {
  if (await getCurrentUser()) redirect("/app");
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo className="text-text" />
        <nav className="flex items-center gap-2">
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-text">
            Iniciar sesión
          </Link>
          <ButtonLink href="/register">Crear cuenta</ButtonLink>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section className="max-w-3xl py-16 sm:py-28">
          <p className="mb-5 text-sm font-medium tracking-wide text-accent-700 dark:text-accent-300">Un espacio de estudio para medicina y ciencias</p>
          <h1 className="title-serif text-[2.6rem] leading-[1.08] text-text sm:text-[3.6rem]">Tus libros, tus apuntes y tu memoria, en un solo lugar.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Escribe, contrasta con fuentes fiables y convierte lo que estudias en práctica de recuerdo activo con repasos programados para que lo recuerdes semanas después.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/register" size="lg">
              Empezar
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="lg">
              Ya tengo cuenta
            </ButtonLink>
          </div>
        </section>
        <section className="grid gap-x-12 gap-y-10 border-t border-line py-16 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.t}>
              <span className="font-serif text-sm text-accent-700 dark:text-accent-300">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="title-serif mt-1 text-xl">{s.t}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </section>
        <section className="mb-20 border-t border-line py-14">
          <h2 className="title-serif text-2xl">Ejemplo: fisiología muscular</h2>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted">
            Escribes en clase que «el calcio se une a la tropomiosina». VANCE lo contrasta con tu libro, te muestra el fragmento de la página donde dice que se une a la troponina C, te propone la corrección sin borrar tu texto y, después, te pide reconstruir el acoplamiento excitación-contracción y predecir qué ocurre si se bloquea RyR1… y vuelve a preguntártelo dentro de unos días.
          </p>
          <p className="mt-5 text-xs text-muted">Las estadísticas reflejan tu rendimiento en las actividades; no miden directamente la memoria biológica.</p>
        </section>
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">Tus documentos y apuntes son privados. Sube solo material que tengas derecho a usar para tu estudio.</footer>
    </div>
  );
}
