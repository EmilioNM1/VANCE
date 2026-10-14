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

test("móvil: márgenes laterales, nada se sale de la pantalla y la navegación no tapa el estudio", async ({ page }, info) => {
  const width = page.viewportSize()!.width;
  test.skip(width >= 768, "solo pantallas de teléfono");
  await page.goto("/");
  await noOverflow(page, `${info.project.name} portada`);
  await loginDemo(page);
  // Biblioteca → documento → informe → conceptos (títulos largos, insignias y pestañas)
  await page.goto("/app/library");
  await page.locator('main a[href^="/app/library/"]').first().click();
  await page.waitForURL(/\/app\/library\/[0-9a-f-]{36}$/);
  await noOverflow(page, `${info.project.name} biblioteca`);
  const doc = (await page.locator('a[href^="/app/documents/"]').first().getAttribute("href"))!;
  for (const path of [doc, `${doc}/verification`, `${doc}/concepts`]) {
    await page.goto(path);
    await noOverflow(page, `${info.project.name} ${path}`);
  }
  // Ningún botón del contenido toca el borde de la pantalla
  const tight = await page.evaluate((w) => [...document.querySelectorAll("main button, main a")].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.width < w && !el.closest(".overflow-x-auto") && (b.left < 8 || b.right > w - 8);
  }).map((el) => (el as HTMLElement).innerText.slice(0, 30)), width);
  expect(tight, "elementos pegados al borde").toEqual([]);
  // El texto del editor tiene margen lateral
  await page.goto("/app/notebooks");
  await page.fill("#new-notebook", `Márgenes ${Date.now()}`);
  await page.getByRole("button", { name: "Crear y escribir" }).click();
  await page.waitForSelector(".ProseMirror");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Un párrafo con margen.");
  const p = await page.locator(".ProseMirror p").first().boundingBox();
  expect(p!.x).toBeGreaterThanOrEqual(14);
  expect(p!.x + p!.width).toBeLessThanOrEqual(width - 14);
  // En una sesión de estudio la barra inferior no tapa las respuestas
  await page.goto("/app/reviews");
  await page.getByRole("button", { name: "Sesión diaria" }).click();
  await page.waitForURL(/\/app\/study\//);
  await expect(page.getByRole("navigation", { name: "Principal móvil" })).toHaveCount(0);
  await noOverflow(page, `${info.project.name} estudio`);
});
