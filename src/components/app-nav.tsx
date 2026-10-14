"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, Brain, ChartNoAxesColumn, House, LogOut, NotebookPen, Plus, Settings } from "lucide-react";
import { clsx, Spinner } from "./ui";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Menu } from "./ui-overlays";
import { api } from "@/lib/api";
import { NOTEBOOK_DOT } from "@/lib/labels";

const NAV = [
  { href: "/app", label: "Inicio", icon: House },
  { href: "/app/notebooks", label: "Cuadernos", icon: NotebookPen },
  { href: "/app/library", label: "Biblioteca", icon: BookOpen },
  { href: "/app/reviews", label: "Repasos", icon: Brain },
  { href: "/app/stats", label: "Progreso", icon: ChartNoAxesColumn },
];

const MOBILE_NAV = [
  { href: "/app", label: "Inicio", icon: House },
  { href: "/app/notebooks", label: "Cuadernos", icon: NotebookPen },
  { href: "/app/reviews", label: "Repasos", icon: Brain },
  { href: "/app/library", label: "Libros", icon: BookOpen },
];

export function useQuickPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ page: { id: string } }>("/api/notes/quick-page", { method: "POST" });
      router.push(`/app/notebooks/page/${r.page.id}`);
    } finally {
      setBusy(false);
    }
  };
  return { create, busy };
}

/**
 * Navegación adaptable:
 * - Escritorio: barra lateral completa (se reduce a carril en el modo de escritura).
 * - iPad/tableta: carril de iconos.
 * - Móvil: barra inferior; se oculta en el editor para dejar todo el espacio a la escritura.
 */
export function AppShell({ userName, notebooks, due, children }: { userName: string; notebooks: { id: string; title: string; color: string }[]; due: number; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { create, busy } = useQuickPage();
  const writing = path.startsWith("/app/notebooks/page/");
  const studying = path.startsWith("/app/study/");
  const focus = writing || studying;
  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const MobileItem = ({ href, label, icon: Icon }: (typeof MOBILE_NAV)[number]) => (
    <Link href={href} aria-current={active(href) ? "page" : undefined} className={clsx("relative flex flex-col items-center gap-1 pb-2 pt-2 text-[11px] font-medium", active(href) ? "text-accent-700 dark:text-accent-300" : "text-muted")}>
      <span className={clsx("flex h-8 w-14 items-center justify-center rounded-full transition-colors", active(href) && "bg-accent-100 dark:bg-accent-900/60")}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={active(href) ? 2.1 : 1.8} />
      </span>
      {label}
      {href === "/app/reviews" && due > 0 && (
        <span className="absolute right-[18%] top-1 min-w-[18px] rounded-full bg-coral-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">{due > 99 ? "99+" : due}</span>
      )}
    </Link>
  );

  const Item = ({ href, label, icon: Icon, rail }: (typeof NAV)[number] & { rail?: boolean }) => (
    <Link
      href={href}
      aria-current={active(href) ? "page" : undefined}
      title={rail ? label : undefined}
      className={clsx(
        "group relative flex items-center gap-3 rounded-lg text-[14px] font-medium transition-colors",
        rail ? "h-10 w-10 justify-center" : "px-2.5 py-1.5",
        active(href) ? "bg-accent-100/80 text-accent-800 dark:bg-accent-900/50 dark:text-accent-100" : "text-muted hover:bg-surface hover:text-text",
      )}
    >
      <Icon className={clsx("h-[18px] w-[18px] shrink-0", active(href) && "text-accent-600 dark:text-accent-300")} strokeWidth={1.8} />
      {!rail && <span className="flex-1">{label}</span>}
      {href === "/app/reviews" && due > 0 && (
        <span className={clsx("rounded-full bg-coral-500 px-1.5 text-[11px] font-semibold tabular-nums text-white", rail && "absolute -right-1 -top-1")}>{due > 99 ? "99+" : due}</span>
      )}
    </Link>
  );

  return (
    <div className="min-h-screen">
      {/* Escritorio completo */}
      <aside className={clsx("fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-sunken/60 px-3 pb-4 pt-5", !focus && "lg:flex")}>
        <div className="mb-5 flex items-center justify-between px-1.5">
          <Link href="/app" className="text-text">
            <Logo />
          </Link>
          <ThemeToggle compact />
        </div>
        <button onClick={create} disabled={busy} className="mb-5 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 px-3 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
          {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Nueva página
        </button>
        <nav className="flex flex-col gap-0.5" aria-label="Principal">
          {NAV.map((n) => (
            <Item key={n.href} {...n} />
          ))}
        </nav>
        {notebooks.length > 0 && (
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Cuadernos</p>
            {notebooks.slice(0, 12).map((n) => (
              <Link key={n.id} href={`/app/notebooks/${n.id}`} className={clsx("flex items-center gap-2.5 truncate rounded-md px-2.5 py-1.5 text-[13.5px]", path.startsWith(`/app/notebooks/${n.id}`) ? "bg-surface text-text" : "text-muted hover:text-text")}>
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", NOTEBOOK_DOT[n.color] ?? NOTEBOOK_DOT.teal)} />
                <span className="truncate">{n.title}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center gap-1 border-t border-line pt-3">
          <Link href="/app/settings" className={clsx("flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px]", active("/app/settings") ? "text-text" : "text-muted hover:text-text")}>
            <Settings className="h-4 w-4 shrink-0" />
            <span className="truncate">{userName}</span>
          </Link>
          <button onClick={logout} className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-text" aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Carril (tableta, y escritorio en modo escritura/estudio) */}
      <aside className={clsx("fixed inset-y-0 left-0 z-30 hidden w-16 flex-col items-center gap-1 border-r border-line bg-sunken/60 py-4", focus ? "md:flex" : "md:flex lg:hidden")}>
        <Link href="/app" className="mb-3" aria-label="Inicio">
          <Logo mark />
        </Link>
        <button onClick={create} disabled={busy} className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-glow hover:brightness-110" aria-label="Nueva página" title="Nueva página">
          {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-[18px] w-[18px]" />}
        </button>
        <nav className="flex flex-col gap-1" aria-label="Principal">
          {NAV.map((n) => (
            <Item key={n.href} {...n} rail />
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <ThemeToggle compact />
          <Link href="/app/settings" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-text" aria-label="Ajustes" title="Ajustes">
            <Settings className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </aside>

      {/* Móvil: barra inferior al alcance del pulgar, con la acción principal (escribir) en el centro.
          Se oculta mientras se escribe o se estudia. */}
      {!focus && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
          aria-label="Principal móvil"
        >
          <div className="mx-auto grid max-w-md grid-cols-5 items-end px-1">
            {MOBILE_NAV.slice(0, 2).map((n) => <MobileItem key={n.href} {...n} />)}
            <div className="flex justify-center">
              <button
                onClick={create}
                disabled={busy}
                aria-label="Nueva página"
                className="-mt-5 mb-1.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-700 text-white shadow-glow ring-4 ring-paper transition active:scale-95"
              >
                {busy ? <Spinner className="h-5 w-5" /> : <Plus className="h-6 w-6" strokeWidth={2.2} />}
              </button>
            </div>
            {MOBILE_NAV.slice(2).map((n) => <MobileItem key={n.href} {...n} />)}
          </div>
        </nav>
      )}

      <div className={clsx(focus ? "md:pl-16" : "md:pl-16 lg:pl-60")}>
        {!focus && (
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line/70 bg-paper/85 px-4 backdrop-blur-lg md:hidden">
            <Link href="/app" className="text-text" aria-label="Inicio">
              <Logo />
            </Link>
            <Menu
              label="Mi cuenta"
              trigger={
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 text-[15px] font-semibold text-accent-800 dark:bg-accent-900/60 dark:text-accent-200">
                  {userName.trim().charAt(0).toUpperCase() || "V"}
                </span>
              }
              items={[
                { label: "Mi progreso", icon: <ChartNoAxesColumn className="h-4 w-4" />, onSelect: () => router.push("/app/stats") },
                { label: "Ajustes y tema", icon: <Settings className="h-4 w-4" />, onSelect: () => router.push("/app/settings") },
                "separator",
                { label: "Cerrar sesión", icon: <LogOut className="h-4 w-4" />, onSelect: logout },
              ]}
            />
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
