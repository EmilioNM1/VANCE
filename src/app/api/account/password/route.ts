import { z } from "zod";
import { authedRoute, readJson, json } from "@/server/http";
import { changePassword } from "@/server/auth/service";

export const POST = authedRoute(async (req, user) => {
  const { current, next } = z.object({ current: z.string(), next: z.string() }).parse(await readJson(req));
  await changePassword(user.id, current, next);
  return json({ ok: true });
});
