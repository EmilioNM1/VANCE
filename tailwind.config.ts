import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f6f7fb",
          100: "#eceef6",
          200: "#d7dbea",
          300: "#b4bad3",
          400: "#8890b2",
          500: "#646d93",
          600: "#4c5478",
          700: "#3a4161",
          800: "#272c45",
          900: "#171a2e",
          950: "#0d0f1d",
        },
        accent: {
          50: "#f1f0ff",
          100: "#e4e2ff",
          200: "#cbc7ff",
          300: "#a8a0ff",
          400: "#8a7dfc",
          500: "#6f5cf5",
          600: "#5c45e6",
          700: "#4c36c7",
          800: "#3e2fa1",
          900: "#352c7f",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(13,15,29,.04), 0 4px 16px rgba(13,15,29,.06)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: { "fade-in": "fade-in .25s ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
