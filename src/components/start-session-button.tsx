"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "./ui";

export function StartSessionButton({
  mode,
  documentId,
  conceptId,
  pageId,
  notebookSectionId,
  focus,
  types,
  size,
  children,
  variant = "primary",
  className,
}: {
  mode: "DAILY" | "DOCUMENT" | "CONCEPT" | "CUMULATIVE" | "PAGE" | "SECTION";
  documentId?: string;
  conceptId?: string;
  pageId?: string;
  notebookSectionId?: string;
  focus?: "ALL" | "ERRORS" | "NOTES" | "BOOK" | "COMBINED";
  types?: string[];
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "quiet" | "inverse";
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={className}>
      <Button
        variant={variant}
        size={size}
        className="w-full sm:w-auto"
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const r = await api<{ sessionId: string }>("/api/study/sessions", { body: { mode, documentId, conceptId, pageId, notebookSectionId, focus, types } });
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
