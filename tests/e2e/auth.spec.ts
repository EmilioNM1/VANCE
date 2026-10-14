import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test("registro, cierre de sesión e inicio de sesión", async ({ page }) => {
  const email = await register(page, "Ana Prueba");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ana");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL("**/login");
  await page.goto("/app");
  await page.waitForURL(/\/login\?next=%2Fapp/);
  await page.fill("#email", email);
  await page.fill("#password", "mala-contraseña");
  await page.click("button[type=submit]");
  await expect(page.getByText("Correo o contraseña incorrectos")).toBeVisible();
  await page.fill("#password", "contraseña-e2e-segura");
  await page.click("button[type=submit]");
  await page.waitForURL("**/app");
});

test("recuperación de contraseña responde sin revelar si la cuenta existe", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.fill("#email", "no-existe@test.local");
  await page.click("button[type=submit]");
  await expect(page.getByText("Si existe una cuenta con ese correo")).toBeVisible();
});

test("la API rechaza peticiones de otro origen (CSRF)", async ({ request }) => {
  const r = await request.post("/api/libraries", { data: { name: "x" }, headers: { origin: "https://evil.example" } });
  expect(r.status()).toBe(403);
});
