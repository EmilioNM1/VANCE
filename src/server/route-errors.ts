import { HttpError } from "./http";
import { ConflictError, NotFoundError } from "./documents/service";
import { FileValidationError } from "./documents/file-validation";
import { ContentValidationError } from "./notebooks/content";
import { VersionConflictError } from "./notebooks/service";
import { NextResponse } from "next/server";

/** Traduce errores de dominio a errores HTTP. */
export function domainToHttp(e: unknown): never {
  if (e instanceof NotFoundError) throw new HttpError(404, e.message, "NOT_FOUND");
  if (e instanceof ConflictError) throw new HttpError(409, e.message, "CONFLICT");
  if (e instanceof FileValidationError) throw new HttpError(400, e.message, "INVALID_FILE");
  if (e instanceof ContentValidationError) throw new HttpError(400, e.message, "INVALID_CONTENT");
  throw e;
}

export async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    domainToHttp(e);
  }
}

/** Conflicto de versión al guardar: se devuelve la versión del servidor para resolverlo. */
export function conflictResponse(e: unknown) {
  if (e instanceof VersionConflictError)
    return NextResponse.json({ error: e.message, code: "VERSION_CONFLICT", server: e.server }, { status: 409 });
  return null;
}
