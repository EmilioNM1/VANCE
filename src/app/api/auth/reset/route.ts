import { z } from "zod";
import { publicRoute, readJson, json } from "@/server/http";
import { resetPassword } from "@/server/auth/service";

export const POST = publicRoute(async (req) => {
  const { token, password } = z.object({ token: z.string().min(10).max(200), password: z.string() }).parse(await readJson(req));
  await resetPassword(token, password);
  return json({ ok: true });
});
