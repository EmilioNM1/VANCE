import { z } from "zod";
import { authedRoute, readJson, json } from "@/server/http";
import { deleteAccount } from "@/server/account";
import { clearSessionCookie } from "@/server/auth/session";

export const POST = authedRoute(async (req, user) => {
  const { password } = z.object({ password: z.string() }).parse(await readJson(req));
  await deleteAccount(user.id, password);
  await clearSessionCookie();
  return json({ ok: true });
});
