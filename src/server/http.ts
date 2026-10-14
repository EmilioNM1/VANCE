import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser } from "./auth/session";
import type { PublicUser } from "./auth/service";
import { AuthError } from "./auth/service";
import { AiUnavailableError, AiBudgetExceededError } from "./ai/errors";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Recurso") => new HttpError(404, `${what} no encontrado`, "NOT_FOUND");

/**
 * Protección CSRF: las peticiones que modifican estado deben venir del mismo origen.
 * (La cookie de sesión además es SameSite=Lax.)
 */
function checkOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) throw new HttpError(403, "Origen no permitido", "BAD_ORIGIN");
  try {
    if (new URL(origin).host !== host) throw new Error();
  } catch {
    throw new HttpError(403, "Origen no permitido", "BAD_ORIGIN");
  }
}

function toResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof AuthError) {
    const status = e.code === "RATE_LIMITED" ? 429 : e.code === "EMAIL_TAKEN" ? 409 : e.code === "INVALID_CREDENTIALS" ? 401 : 400;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  if (e instanceof ZodError)
    return NextResponse.json({ error: e.issues[0]?.message ?? "Datos no válidos", code: "INVALID_INPUT" }, { status: 400 });
  if (e instanceof AiBudgetExceededError) return NextResponse.json({ error: e.message, code: "AI_BUDGET" }, { status: 429 });
  if (e instanceof AiUnavailableError) return NextResponse.json({ error: e.message, code: "AI_UNAVAILABLE" }, { status: 503 });
  const pg = e as { code?: string; cause?: { code?: string } };
  if (pg?.code === "22P02" || pg?.cause?.code === "22P02") return NextResponse.json({ error: "Recurso no encontrado", code: "NOT_FOUND" }, { status: 404 });
  console.error(e);
  return NextResponse.json({ error: "Error interno. Inténtalo de nuevo.", code: "INTERNAL" }, { status: 500 });
}

type Ctx<P> = { params: Promise<P> };

export function publicRoute<P = Record<string, string>>(fn: (req: NextRequest, ctx: Ctx<P>) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      return toResponse(e);
    }
  };
}

export function authedRoute<P = Record<string, string>>(
  fn: (req: NextRequest, user: PublicUser, params: P) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      checkOrigin(req);
      const user = await getCurrentUser();
      if (!user) throw new HttpError(401, "Debes iniciar sesión", "UNAUTHENTICATED");
      return await fn(req, user, await ctx.params);
    } catch (e) {
      return toResponse(e);
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Cuerpo JSON no válido", "INVALID_JSON");
  }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
