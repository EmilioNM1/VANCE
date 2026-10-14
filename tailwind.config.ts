import type { Config } from "tailwindcss";

/**
 * Sistema visual de VANCE: editorial, cálido y sobrio.
 * - Tokens semánticos (paper/surface/sunken/line/text/muted) definidos como variables CSS, con
 *   valores propios en modo claro y oscuro (globals.css).
 * - "ink": neutros cálidos; "accent": verde petróleo profundo (concentración, calma).
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
          50: "#faf8f4",
          100: "#f3f0ea",
          200: "#e7e2d9",
          300: "#d3ccc0",
          400: "#a8a196",
          500: "#7d776d",
          600: "#5e5950",
          700: "#45413a",
          800: "#2c2a26",
          900: "#1c1b19",
          950: "#121110",
        },
        accent: {
          50: "#eef7f6",
          100: "#d5edea",
          200: "#acdad4",
          300: "#7dc1b9",
          400: "#4fa59c",
          500: "#2e8981",
          600: "#1f6e68",
          700: "#1b5a55",
          800: "#194946",
          900: "#163c3a",
          950: "#0b2422",
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ['"Source Serif 4 Variable"', '"Source Serif 4"', "Georgia", "Cambria", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(28 27 25 / .04)",
        float: "0 8px 30px rgb(28 27 25 / .10), 0 1px 3px rgb(28 27 25 / .06)",
        paper: "0 1px 3px rgb(28 27 25 / .06), 0 12px 40px rgb(28 27 25 / .05)",
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
