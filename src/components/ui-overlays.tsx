"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton, clsx } from "./ui";

// ───────────────────────────── Menú desplegable ─────────────────────────────

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** Menú accesible (teclado: flechas, Esc). Se cierra al hacer clic fuera. */
export function Menu({ trigger, items, align = "right", label }: { trigger: ReactNode; items: (MenuItem | "separator")[]; align?: "left" | "right"; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
            const i = els.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") (els[(i + 1) % els.length] ?? els[0])?.focus();
            if (e.key === "ArrowUp") (els[(i - 1 + els.length) % els.length] ?? els[0])?.focus();
            if (e.key.startsWith("Arrow")) e.preventDefault();
          }}
          className={clsx("absolute top-full z-50 mt-1 min-w-[13rem] animate-fade-in rounded-2xl border border-line bg-surface shadow-card p-1.5 shadow-float", align === "right" ? "right-0" : "left-0")}
        >
          {items.map((it, i) =>
            it === "separator" ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onSelect();
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[15px] hover:bg-sunken sm:px-2.5 sm:py-1.5 sm:text-sm focus:bg-sunken focus:outline-none disabled:opacity-40",
                  it.danger ? "text-rose-600 dark:text-rose-400" : "text-text",
                )}
              >
                {it.icon && <span className="text-muted">{it.icon}</span>}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-xs text-muted">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Diálogo / hoja ─────────────────────────────

/** Diálogo modal; en móvil se presenta como hoja desde abajo. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([aria-label='Cerrar'])")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-ink-950/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "relative max-h-[88vh] w-full animate-slide-up overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-float sm:animate-fade-in sm:rounded-xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-md",
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="title-serif text-lg">{title}</h2>
          <IconButton label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

