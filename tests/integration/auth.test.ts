import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { passwordResetTokens } from "@/db/schema";
import { authenticate, changePassword, createSession, destroySession, getUserBySessionToken, registerUser, requestPasswordReset, resetPassword } from "@/server/auth/service";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("autenticación", () => {
  it("hash de contraseñas con scrypt y verificación", async () => {
    const h = await hashPassword("una-contraseña-larga");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("una-contraseña-larga", h)).toBe(true);
    expect(await verifyPassword("otra", h)).toBe(false);
  });

  it("registro, duplicados y validación", async () => {
    const email = `ana${Date.now()}@test.local`;
    const u = await registerUser({ name: "Ana", email: email.toUpperCase(), password: "contraseña-segura-1" });
    expect(u.email).toBe(email);
    await expect(registerUser({ name: "Ana", email, password: "contraseña-segura-1" })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(registerUser({ name: "Ana", email: "x@y.z", password: "corta" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("inicio y cierre de sesión", async () => {
    const email = `luis${Date.now()}@test.local`;
    const u = await registerUser({ name: "Luis", email, password: "contraseña-segura-2" });
    await expect(authenticate({ email, password: "mala-contraseña" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(authenticate({ email: "noexiste@test.local", password: "x" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await authenticate({ email, password: "contraseña-segura-2" })).id).toBe(u.id);
    const { token } = await createSession(u.id, "test");
    expect((await getUserBySessionToken(token))?.id).toBe(u.id);
    expect(await getUserBySessionToken("token-falso")).toBeNull();
    await destroySession(token);
    expect(await getUserBySessionToken(token)).toBeNull();
  });

  it("recuperación de contraseña: un solo uso y cierra sesiones", async () => {
    const email = `eva${Date.now()}@test.local`;
    const u = await registerUser({ name: "Eva", email, password: "contraseña-segura-3" });
    const { token: sessionToken } = await createSession(u.id);
    expect(await requestPasswordReset("nadie@test.local")).toBeNull();
    const link = (await requestPasswordReset(email))!;
    const token = new URL(link).searchParams.get("token")!;
    await resetPassword(token, "nueva-contraseña-segura");
    await expect(resetPassword(token, "otra-contraseña-segura")).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    expect(await getUserBySessionToken(sessionToken)).toBeNull();
    expect((await authenticate({ email, password: "nueva-contraseña-segura" })).id).toBe(u.id);
    const rows = await getDb().select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, u.id));
    expect(rows.every((r) => r.tokenHash !== token)).toBe(true); // solo se guarda el hash
  });

  it("cambio de contraseña exige la actual", async () => {
    const email = `rui${Date.now()}@test.local`;
    const u = await registerUser({ name: "Rui", email, password: "contraseña-segura-4" });
    await expect(changePassword(u.id, "mal", "nueva-contraseña-segura")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await changePassword(u.id, "contraseña-segura-4", "nueva-contraseña-segura");
    expect((await authenticate({ email, password: "nueva-contraseña-segura" })).id).toBe(u.id);
  });
});
