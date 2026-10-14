import { z } from "zod";
import { publicRoute, readJson, json, HttpError } from "@/server/http";
import { requestPasswordReset } from "@/server/auth/service";
import { rateLimit } from "@/server/rate-limit";

export const POST = publicRoute(async (req) => {
  const { email } = z.object({ email: z.string().email("Correo no válido") }).parse(await readJson(req));
  if (!rateLimit(`forgot:${email.toLowerCase()}`, 3, 60 * 60_000)) throw new HttpError(429, "Ya se han solicitado varios enlaces. Espera un rato.");
  await requestPasswordReset(email);
  // Respuesta idéntica exista o no la cuenta (evita enumeración de usuarios)
  return json({ ok: true, smtpConfigured: !!process.env.SMTP_URL });
});
