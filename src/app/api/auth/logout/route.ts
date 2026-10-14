import { cookies } from "next/headers";
import { publicRoute, json } from "@/server/http";
import { destroySession } from "@/server/auth/service";
import { clearSessionCookie, SESSION_COOKIE } from "@/server/auth/session";

export const POST = publicRoute(async () => {
  await destroySession((await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return json({ ok: true });
});
