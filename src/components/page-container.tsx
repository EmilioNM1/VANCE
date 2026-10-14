import { clsx } from "./ui";

/** Contenedor estándar de las pantallas (márgenes cómodos, ancho de lectura). */
export function Page({ children, wide, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return <main className={clsx("mx-auto px-4 pb-28 pt-6 sm:px-8 md:pb-16 md:pt-12", wide ? "max-w-6xl" : "max-w-4xl", className)}>{children}</main>;
}
