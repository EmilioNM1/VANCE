"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "./ui";

export function StartSessionButton({
  mode,
  documentId,
  conceptId,
  children,
  variant = "primary",
  className,
}: {
  mode: "DAILY" | "DOCUMENT" | "CONCEPT" | "CUMULATIVE";
  documentId?: string;
  conceptId?: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={className}>
      <Button
        variant={variant}
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const r = await api<{ sessionId: string }>("/api/study/sessions", { body: { mode, documentId, conceptId } });
            router.push(`/app/study/${r.sessionId}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Error");
            setLoading(false);
          }
        }}
      >
        {children}
      </Button>
      {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
