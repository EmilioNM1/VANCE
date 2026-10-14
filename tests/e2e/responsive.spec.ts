import { expect, test } from "@playwright/test";
import { loginDemo } from "./helpers";

test("diseño móvil: navegación inferior y sin desbordamiento horizontal", async ({ page }) => {
  await loginDemo(page);
  await expect(page.getByRole("navigation", { name: "Principal móvil" })).toBeVisible();
  for (const path of ["/app", "/app/library", "/app/reviews", "/app/stats", "/app/settings"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
