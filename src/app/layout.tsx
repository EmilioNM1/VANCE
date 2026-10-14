import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VANCE — Tu espacio de estudio", template: "%s · VANCE" },
  description: "Libros, apuntes y memoria en un mismo lugar: verificación de contenidos, recuerdo activo y repetición espaciada.",
  appleWebApp: { capable: true, title: "VANCE", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#161513" },
    { color: "#faf8f4" },
  ],
};

/** Aplica el tema antes de pintar (evita el destello claro/oscuro). */
const THEME_SCRIPT = `try{var t=localStorage.getItem('vance-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
