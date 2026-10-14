export function Logo({ className = "", mark = false }: { className?: string; mark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent-400 to-accent-700 shadow-sm shadow-accent-700/30" aria-hidden>
        <svg viewBox="0 0 32 32" className="h-7 w-7">
          <path d="M9 9.5l7 13 7-13" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="absolute bottom-[3px] right-[3px] h-[6px] w-[6px] rounded-full bg-coral-400" />
      </span>
      {!mark && <span className="font-serif text-[1.15rem] font-semibold tracking-tight">Vance</span>}
    </span>
  );
}
