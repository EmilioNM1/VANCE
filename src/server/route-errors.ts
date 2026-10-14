import { HttpError } from "./http";
import { ConflictError, NotFoundError } from "./documents/service";
import { FileValidationError } from "./documents/file-validation";

/** Traduce errores de dominio a errores HTTP. */
export function domainToHttp(e: unknown): never {
  if (e instanceof NotFoundError) throw new HttpError(404, e.message, "NOT_FOUND");
  if (e instanceof ConflictError) throw new HttpError(409, e.message, "CONFLICT");
  if (e instanceof FileValidationError) throw new HttpError(400, e.message, "INVALID_FILE");
  throw e;
}

export async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    domainToHttp(e);
  }
}
