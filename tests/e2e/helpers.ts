import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export async function register(page: Page, name = "E2E") {
  const email = `e2e-${randomUUID()}@test.local`;
  await page.goto("/register");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", "contraseña-e2e-segura");
  await page.click("button[type=submit]");
  await page.waitForURL("**/app");
  return email;
}

export async function loginDemo(page: Page) {
  await page.goto("/login");
  await page.fill("#email", "demo@vance.local");
  await page.fill("#password", "demo-vance-2026");
  await page.click("button[type=submit]");
  await page.waitForURL("**/app");
}

export async function createLibrary(page: Page, name: string) {
  await page.goto("/app/library");
  await page.fill("#lib-name", name);
  await page.click("form >> text=Crear");
  await page.waitForURL(/\/app\/library\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

export async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.setInputFiles("input[type=file]", file);
  await page.check("input[type=checkbox]");
  await page.click("text=Subir y procesar");
  await page.waitForURL(/\/app\/documents\/[0-9a-f-]{36}$/);
}
