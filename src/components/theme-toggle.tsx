"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "./ui";

type Mode = "system" | "light" | "dark";

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Selector de tema (sistema / claro / oscuro), recordado en este dispositivo. */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    try {
      setMode((localStorage.getItem("vance-theme") as Mode) || "system");
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  useEffect(() => {
    if (mode !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode]);
  const set = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem("vance-theme", m);
    } catch {
      /* ignorar */
    }
    apply(m);
  };
  const opts: { m: Mode; icon: typeof Sun; label: string }[] = [
    { m: "light", icon: Sun, label: "Claro" },
    { m: "dark", icon: Moon, label: "Oscuro" },
    { m: "system", icon: Monitor, label: "Sistema" },
  ];
  if (compact) {
    const next = opts[(opts.findIndex((o) => o.m === mode) + 1) % 3]!;
    const Cur = opts.find((o) => o.m === mode)!.icon;
    return (
      <button type="button" onClick={() => set(next.m)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-text" aria-label={`Tema: ${mode}. Cambiar a ${next.label}`} title={`Tema (${opts.find((o) => o.m === mode)!.label})`}>
        <Cur className="h-[18px] w-[18px]" />
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {opts.map(({ m, icon: Icon, label }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => set(m)}
          className={clsx("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium", mode === m ? "bg-surface text-text shadow-card" : "text-muted hover:text-text")}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
