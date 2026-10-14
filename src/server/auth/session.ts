import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserBySessionToken, type PublicUser } from "./service";

export const SESSION_COOKIE = "vance_session";

export async function getCurrentUser(): Promise<PublicUser | null> {
  const store = await cookies();
  return getUserBySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Para Server Components: redirige a /login si no hay sesión válida. */
export async function requireUser(): Promise<PublicUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function clientUserAgent() {
  return (await headers()).get("user-agent");
}
