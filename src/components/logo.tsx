export function Logo({ className = "", mark = false }: { className?: string; mark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-accent-600 dark:fill-accent-500" />
        <path d="M9 9.5l7 13 7-13" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!mark && <span className="font-serif text-[1.15rem] font-semibold tracking-tight">Vance</span>}
    </span>
  );
}
