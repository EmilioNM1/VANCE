import { expect, test } from "@playwright/test";
import { loginDemo } from "./helpers";

test("sesión de recuerdo activo con la biblioteca de demostración", async ({ page }) => {
  await loginDemo(page);
  await page.goto("/app/library");
  await page.getByText("Demostración: Fisiología").click();
  await page.getByText("Contracción del músculo esquelético (demo)").click();
  await page.getByRole("link", { name: "Explorar conceptos" }).click();
  await page.getByText("Acoplamiento excitación-contracción").first().click();
  await page.getByRole("button", { name: "Practicar este concepto" }).click();
  await page.waitForURL(/\/app\/study\//);

  // 1) Explicación con palabras propias: no se muestra la respuesta antes de intentarlo
  await expect(page.getByText("Explícalo con tus palabras")).toBeVisible();
  await expect(page.getByText("Respuesta modelo")).toHaveCount(0);
  await page.getByRole("button", { name: "No lo recuerdo: dame una pista" }).click();
  await expect(page.getByText("Pista general:")).toBeVisible();
  await page.fill("#answer", "La neurona libera acetilcolina y luego sale calcio del retículo sarcoplásmico que se une a la troponina.");
  await page.getByRole("button", { name: "Comprobar" }).click();
  // Sin IA: evaluación provisional claramente identificada
  await expect(page.getByText(/provisional/i).first()).toBeVisible({ timeout: 15_000 });

  // Pide ayuda hasta la explicación completa y recupera de nuevo
  for (let i = 0; i < 4; i++) {
    const more = page.getByRole("button", { name: /Necesito más ayuda|Ver la explicación completa/ });
    if (await more.isVisible().catch(() => false)) await more.click();
    if (await page.getByText("He terminado de leer").isVisible().catch(() => false)) break;
    const again = page.getByRole("button", { name: "Comprobar de nuevo" });
    if (await again.isVisible().catch(() => false) && !(await page.getByText("He terminado de leer").isVisible().catch(() => false))) {
      await page.fill("#answer", "No me acuerdo bien.");
      await again.click();
      await page.waitForTimeout(500);
    }
  }
  await page.getByRole("button", { name: /He terminado de leer/ }).click();
  await expect(page.locator("#answer")).toBeVisible();
  await page.fill("#answer", "Acetilcolina, potencial de acción, túbulos T, DHPR activa RyR1, liberación de calcio del retículo sarcoplásmico, el calcio se une a la troponina, la tropomiosina expone la actina y la miosina genera fuerza.");
  await page.getByRole("button", { name: /Comprobar/ }).click();
  await expect(page.getByRole("button", { name: "Siguiente" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Explicación", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();

  // 2) Reconstrucción del proceso: interacción real con teclado (arrastrar) y botones
  await expect(page.getByText("Reconstrucción de proceso")).toBeVisible();
  const steps = page.locator("ol[aria-label='Pasos del proceso'] > li");
  await expect(steps).toHaveCount(7);
  const firstBefore = await steps.first().innerText();
  await page.getByRole("button", { name: "Bajar paso 1" }).click();
  await expect(steps.nth(1)).toContainText(firstBefore.split("\n").find((l) => l.length > 3)!.trim());
  await page.getByRole("button", { name: "Comprobar" }).click();
  await expect(page.getByText(/pasos están en su posición exacta|Orden correcto/)).toBeVisible({ timeout: 10_000 });
});

test("al volver se reanuda la sesión pendiente", async ({ page }) => {
  await loginDemo(page);
  await expect(page.getByText("Sesiones sin terminar")).toBeVisible();
  await page.getByRole("link", { name: "Continuar" }).first().click();
  await page.waitForURL(/\/app\/study\//);
  await expect(page.getByRole("button", { name: /Comprobar|Siguiente|Volver al panel/ }).first()).toBeVisible();
});
