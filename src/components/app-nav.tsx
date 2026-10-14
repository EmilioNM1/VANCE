"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "./ui";
import { Logo } from "./logo";
import { api } from "@/lib/api";

const items = [
  { href: "/app", label: "Panel", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/app/library", label: "Biblioteca", icon: "M4 5h6v14H4zM14 5h6v14h-6z" },
  { href: "/app/reviews", label: "Repasos", icon: "M8 3v3M16 3v3M4 8h16M5 6h14v14H5z" },
  { href: "/app/stats", label: "Progreso", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/app/settings", label: "Ajustes", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 01-2 1.2L14 21h-4l-.5-2.6a7 7 0 01-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 015 12" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function AppNav({ userName }: { userName: string }) {
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-ink-100 bg-white px-3 py-5 lg:flex dark:border-ink-800 dark:bg-ink-900">
        <Link href="/app" className="mb-8 px-3 text-lg text-ink-900 dark:text-white">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Principal">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active(i.href) ? "page" : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active(i.href) ? "bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200" : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
              )}
            >
              <Icon d={i.icon} />
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-ink-100 px-3 pt-4 text-sm dark:border-ink-800">
          <p className="truncate font-medium text-ink-800 dark:text-ink-100">{userName}</p>
          <button onClick={logout} className="mt-1 text-ink-500 hover:text-accent-600">Cerrar sesión</button>
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-ink-800 dark:bg-ink-900/90">
        <Link href="/app" className="text-ink-900 dark:text-white"><Logo /></Link>
        <button onClick={logout} className="text-sm text-ink-500">Salir</button>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-ink-100 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden dark:border-ink-800 dark:bg-ink-900" aria-label="Principal móvil">
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px]", active(i.href) ? "text-accent-600" : "text-ink-500")}>
            <Icon d={i.icon} />
            {i.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
