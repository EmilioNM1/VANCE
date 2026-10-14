import { publicRoute, readJson, json, HttpError } from "@/server/http";
import { authenticate, createSession } from "@/server/auth/service";
import { clientUserAgent, setSessionCookie } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";

export const POST = publicRoute(async (req) => {
  const body = (await readJson(req)) as { email?: string };
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`login:${ip}`, 30, 15 * 60_000) || !rateLimit(`login:${String(body?.email).toLowerCase()}`, 10, 15 * 60_000))
    throw new HttpError(429, "Demasiados intentos. Espera unos minutos.");
  const user = await authenticate(body);
  const { token, expiresAt } = await createSession(user.id, await clientUserAgent());
  await setSessionCookie(token, expiresAt);
  return json({ user });
});
