import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VANCE — Entrenador de memoria con IA", template: "%s · VANCE" },
  description: "Convierte tus libros y apuntes en entrenamiento de recuerdo activo, con verificación científica, corrección inteligente y repetición espaciada.",
};

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0d0f1d" }, { color: "#f6f7fb" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
