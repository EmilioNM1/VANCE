import { expect, test } from "@playwright/test";
import { loginDemo } from "./helpers";

async function noOverflow(page: import("@playwright/test").Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(1);
}

test("diseño adaptable: navegación, sin desbordamiento y editor cómodo", async ({ page }, info) => {
  await loginDemo(page);
  const width = page.viewportSize()!.width;
  const mobile = width < 768;
  if (mobile) await expect(page.getByRole("navigation", { name: "Principal móvil" })).toBeVisible();
  else await expect(page.getByRole("navigation", { name: "Principal" }).first()).toBeVisible();
  for (const path of ["/app", "/app/notebooks", "/app/library", "/app/reviews", "/app/stats", "/app/settings"]) {
    await page.goto(path);
    await noOverflow(page, `${info.project.name} ${path}`);
  }
  // Editor
  await page.goto("/app/notebooks");
  await page.fill("#new-notebook", `Adaptable ${Date.now()}`);
  await page.getByRole("button", { name: "Crear y escribir" }).click();
  await page.waitForSelector(".ProseMirror");
  await noOverflow(page, `${info.project.name} editor`);
  // Una sola barra de formato visible: superior en tableta/escritorio, inferior en móvil
  const toolbar = page.getByRole("toolbar", { name: "Formato" });
  await expect(toolbar).toHaveCount(1);
  if (mobile) {
    // La barra inferior de navegación se oculta para dejar sitio a la escritura
    await expect(page.getByRole("navigation", { name: "Principal móvil" })).toHaveCount(0);
    const box = await toolbar.last().boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 80);
  }
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Escribir en cualquier dispositivo.");
  await expect(page.locator(".ProseMirror")).toContainText("Escribir en cualquier dispositivo.");
  // Consultar el libro mientras se escribe: en tableta el panel convive con el editor
  await page.getByRole("button", { name: "Libro de referencia" }).click();
  const panel = page.getByRole("complementary", { name: "Libro" });
  await expect(panel).toBeVisible();
  if (!mobile) await expect(page.locator(".ProseMirror")).toBeInViewport();
});
