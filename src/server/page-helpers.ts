import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "./documents/service";

export function isInvalidId(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "22P02" || err?.cause?.code === "22P02";
}

/** Carga datos para una página; recurso ajeno, inexistente o id mal formado → 404. */
export async function loadOr404<T>(fn: () => Promise<T | null>): Promise<T> {
  try {
    const r = await fn();
    if (r === null) notFound();
    return r;
  } catch (e) {
    if (e instanceof NotFoundError || isInvalidId(e)) notFound();
    throw e;
  }
}
