import clsx from "clsx";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export { clsx };

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
const variants: Record<Variant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-600/60 dark:bg-accent-500 dark:hover:bg-accent-400 dark:text-ink-950",
  secondary: "border border-line bg-surface text-text hover:bg-sunken active:bg-sunken",
  ghost: "text-muted hover:bg-sunken hover:text-text",
  quiet: "text-accent-700 hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-900/40",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-400",
};
// En pantallas táctiles los botones son algo más altos (objetivo ≥ 40 px) y el texto largo pasa a otra línea en vez de salirse
const sizes = { sm: "min-h-9 px-3 py-1 text-[13px] sm:min-h-8", md: "min-h-10 px-3.5 py-1.5 text-sm sm:min-h-9", lg: "min-h-12 px-5 py-2 text-[15px] sm:min-h-11" };
const base =
  "inline-flex max-w-full select-none items-center justify-center gap-2 rounded-lg text-center font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; loading?: boolean }) {
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = "primary", size = "md", className, children }: { href: string; variant?: Variant; size?: keyof typeof sizes; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={clsx(base, sizes[size], variants[variant], className)}>
      {children}
    </Link>
  );
}

/** Botón cuadrado con icono; siempre con etiqueta accesible. */
export function IconButton({ label, active, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        "inline-flex h-10 min-w-10 items-center justify-center rounded-md px-1.5 text-muted md:h-8 md:min-w-8 transition-colors hover:bg-sunken hover:text-text disabled:opacity-40",
        active && "bg-accent-50 text-accent-700 dark:bg-accent-900/50 dark:text-accent-200",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-xl border border-line bg-surface p-4 sm:p-5", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex max-w-full items-center gap-1 text-sm text-muted hover:text-accent-700">
            ← <span className="truncate">{back.label}</span>
          </Link>
        )}
        <h1 className="title-serif text-[1.75rem] leading-tight text-text sm:text-[2rem]">{title}</h1>
        {subtitle && <div className="mt-1.5 text-[15px] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</h2>
      {action}
    </div>
  );
}

const tones = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-50 text-accent-800 dark:bg-accent-900/50 dark:text-accent-200",
  success: "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  danger: "bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
  info: "bg-sky-50 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Alert({ tone = "info", title, children }: { tone?: Exclude<Tone, "neutral" | "accent">; title?: string; children: ReactNode }) {
  const bar = { info: "border-sky-400", success: "border-emerald-500", warning: "border-amber-400", danger: "border-rose-500" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("rounded-lg border border-line border-l-[3px] bg-surface px-4 py-3 text-sm text-text", bar)}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      <div className="leading-relaxed text-text/85">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("animate-spin", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Progress({ value, className, tone = "accent", label }: { value: number; className?: string; tone?: "accent" | "success" | "warning"; label?: string }) {
  const color = { accent: "bg-accent-500", success: "bg-emerald-500", warning: "bg-amber-500" }[tone];
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-muted">{icon}</div>}
      <p className="font-medium text-text">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 font-serif text-2xl font-semibold tabular-nums text-text">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// ───────────────────────────── Etiquetas de estado ─────────────────────────────

export const MASTERY_LABEL: Record<string, { label: string; tone: Tone }> = {
  NEW: { label: "Pendiente", tone: "neutral" },
  LEARNING: { label: "Aprendiendo", tone: "warning" },
  CONSOLIDATING: { label: "En consolidación", tone: "info" },
  MASTERED: { label: "Parece dominado", tone: "success" },
  RELEARNING: { label: "Olvidado · recuperar", tone: "danger" },
};

export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  UPLOADED: { label: "En cola", tone: "neutral" },
  EXTRACTING: { label: "Extrayendo texto", tone: "info" },
  EXTRACTED: { label: "Texto extraído", tone: "info" },
  AUDITING: { label: "Verificando", tone: "info" },
  REVIEW: { label: "Revisión pendiente", tone: "warning" },
  BUILDING_KNOWLEDGE: { label: "Construyendo conocimiento", tone: "info" },
  READY: { label: "Listo para estudiar", tone: "success" },
  FAILED: { label: "Error", tone: "danger" },
};

export function formatDate(d: Date | string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("es-ES", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export function relativeDue(d: Date | string | null | undefined) {
  if (!d) return "sin programar";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const txt = mins < 60 ? `${mins} min` : hours < 36 ? `${hours} h` : `${days} días`;
  return diff <= 0 ? `vencido hace ${txt}` : `en ${txt}`;
}

export function relativeTime(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 7 * 86400) return `hace ${Math.round(s / 86400)} días`;
  return formatDate(date);
}
