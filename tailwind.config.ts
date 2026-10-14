import type { Config } from "tailwindcss";

/**
 * Sistema visual de VANCE (regla 60-30-10):
 * - 60 %: neutros fríos y limpios (paper/surface/sunken/line), definidos como variables CSS con
 *   valores propios en modo claro y oscuro (globals.css). El modo oscuro evita el negro puro y
 *   aclara las superficies elevadas.
 * - 30 %: "ink" (azul pizarra) para texto y estructura.
 * - 10 %: "accent" (azul real vivo: concentración y confianza) para acciones y estados activos;
 *   "coral" (cálido) solo para destacar lo pendiente o lo que celebra un logro.
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        surface: v("surface"),
        sunken: v("sunken"),
        line: v("line"),
        text: v("text"),
        muted: v("muted"),
        ink: {
          50: "#f7f8fb",
          100: "#eef1f6",
          200: "#e1e5ee",
          300: "#c8cfdc",
          400: "#9aa3b8",
          500: "#737d95",
          600: "#566077",
          700: "#414a5f",
          800: "#2a3144",
          900: "#181e30",
          950: "#0e1220",
        },
        accent: {
          50: "#eef3ff",
          100: "#dfe8ff",
          200: "#c5d4ff",
          300: "#9db6ff",
          400: "#6f8dff",
          500: "#4a67fb",
          600: "#3549ef",
          700: "#2b39d4",
          800: "#2832ab",
          900: "#263186",
          950: "#1a1e4f",
        },
        coral: {
          50: "#fff4f1",
          100: "#ffe6df",
          200: "#ffcbbd",
          300: "#ffa68f",
          400: "#ff7d5e",
          500: "#f8603d",
          600: "#e44624",
          700: "#bf361a",
          800: "#9d2f1a",
          900: "#822c1b",
          950: "#461209",
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ['"Source Serif 4 Variable"', '"Source Serif 4"', "Georgia", "Cambria", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(20 26 46 / .04), 0 2px 8px rgb(20 26 46 / .03)",
        float: "0 12px 32px rgb(20 26 46 / .12), 0 2px 6px rgb(20 26 46 / .06)",
        paper: "0 1px 3px rgb(20 26 46 / .06), 0 12px 40px rgb(20 26 46 / .06)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(3px)" }, to: { opacity: "1", transform: "none" } },
        "slide-up": { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
      },
      animation: { "fade-in": "fade-in .18s ease-out both", "slide-up": "slide-up .22s cubic-bezier(.2,.8,.2,1) both" },
    },
  },
  plugins: [],
} satisfies Config;
