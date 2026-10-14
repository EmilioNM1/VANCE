import { publicRoute, readJson, json, HttpError } from "@/server/http";
import { registerUser, createSession } from "@/server/auth/service";
import { clientUserAgent, setSessionCookie } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";

export const POST = publicRoute(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`register:${ip}`, Number(process.env.REGISTER_RATE_LIMIT_PER_HOUR ?? 10), 60 * 60_000)) throw new HttpError(429, "Demasiados registros desde esta conexión. Inténtalo más tarde.");
  const user = await registerUser(await readJson(req));
  const { token, expiresAt } = await createSession(user.id, await clientUserAgent());
  await setSessionCookie(token, expiresAt);
  return json({ user }, 201);
});
