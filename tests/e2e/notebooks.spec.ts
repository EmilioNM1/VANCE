import { expect, test, type Page } from "@playwright/test";
import { loginDemo, register } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function newNotebook(page: Page, title: string) {
  await page.goto("/app/notebooks");
  await page.fill("#new-notebook", title);
  await page.getByRole("button", { name: "Crear y escribir" }).click();
  await page.waitForURL(/\/app\/notebooks\/page\//);
  await page.waitForSelector(".ProseMirror");
}

async function waitSaved(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^Guardado$/ }).first()).toBeVisible({ timeout: 15_000 });
}

test("crear un cuaderno, escribir con formato y recuperar todo tras recargar", async ({ page }) => {
  await register(page, "Ana");
  await newNotebook(page, "Fisiología");
  await page.fill("#page-title", "Contracción muscular");
  const ed = page.locator(".ProseMirror");
  await ed.click();
  // Título mediante el menú de estilos
  await page.getByRole("toolbar", { name: "Formato" }).first().getByRole("button", { name: "Estilo de párrafo" }).click();
  await page.getByRole("menuitem", { name: /Título 1/ }).click();
  await page.keyboard.type("Acoplamiento excitación-contracción");
  await page.keyboard.press("Enter");
  await page.keyboard.type("La neurona libera ");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type("acetilcolina");
  await page.keyboard.press(`${MOD}+b`);
  await page.keyboard.type(" en la placa motora.");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Lista con viñetas" }).first().click();
  await page.keyboard.type("Túbulos T");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Retículo sarcoplásmico");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  // Fórmula
  await page.getByRole("button", { name: "Insertar" }).first().click();
  await page.getByRole("menuitem", { name: "Fórmula en bloque" }).click();
  await page.fill("#latex", "E = \\frac{RT}{zF}");
  await expect(page.locator(".katex").first()).toBeVisible();
  await page.getByRole("button", { name: "Insertar", exact: true }).last().click();
  // Tabla
  await page.getByRole("button", { name: "Insertar" }).first().click();
  await page.getByRole("menuitem", { name: "Tabla" }).click();
  await page.keyboard.type("Proteína");
  await waitSaved(page);

  await page.reload();
  await page.waitForSelector(".ProseMirror");
  await expect(page.locator("#page-title")).toHaveValue("Contracción muscular");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Acoplamiento excitación-contracción");
  await expect(page.locator(".ProseMirror strong")).toHaveText("acetilcolina");
  await expect(page.locator(".ProseMirror ul li")).toHaveCount(2);
  await expect(page.locator(".ProseMirror .katex").first()).toBeVisible();
  await expect(page.locator(".ProseMirror table th").first()).toHaveText("Proteína");
  // El explorador y la ruta reflejan el título
  await expect(page.getByRole("navigation", { name: "Ruta" })).toContainText("Contracción muscular");
});

test("buscar y reemplazar dentro de la página, y exportar a DOCX, PDF, Markdown y TXT", async ({ page }) => {
  await register(page);
  await newNotebook(page, "Bioquímica");
  await page.fill("#page-title", "Glucólisis");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("La glucosa se convierte en piruvato. La glucosa entra por GLUT.");
  await page.keyboard.press(`${MOD}+f`);
  await page.fill("#find-term", "glucosa");
  await expect(page.getByText("1 de 2")).toBeVisible();
  await page.getByRole("button", { name: "Reemplazar", exact: true }).click();
  await page.fill("#find-replace", "D-glucosa");
  await page.getByRole("button", { name: "Todos" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("La D-glucosa se convierte en piruvato. La D-glucosa entra");
  await page.getByRole("button", { name: /Cerrar búsqueda/ }).click();
  await waitSaved(page);

  for (const [label, ext, check] of [
    ["Exportar a Word (.docx)", "docx", (b: Buffer) => b.subarray(0, 2).toString() === "PK"],
    ["Exportar a PDF", "pdf", (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-"],
    ["Exportar a Markdown", "md", (b: Buffer) => b.toString().includes("# Glucólisis") && b.toString().includes("D-glucosa")],
    ["Exportar a texto", "txt", (b: Buffer) => b.toString().includes("D-glucosa")],
  ] as const) {
    await page.getByRole("button", { name: "Más acciones" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
    const path = await download.path();
    const fs = await import("node:fs");
    expect(check(fs.readFileSync(path!)), label).toBe(true);
  }
});

test("organizar: nueva sección, nueva página, renombrar y mover", async ({ page }) => {
  await register(page);
  await newNotebook(page, "Fisiología");
  const nbUrl = await page.getByRole("link", { name: "Fisiología" }).first().getAttribute("href");
  await page.goto(nbUrl!);
  await page.getByRole("button", { name: "Nueva sección" }).first().click();
  await page.fill("#prompt-input", "Fisiología muscular");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("heading", { name: "Fisiología muscular" })).toBeVisible();
  // Renombrar la primera página y moverla a la nueva sección
  await page.getByRole("button", { name: /Opciones de la página Sin título/ }).first().click();
  await page.getByRole("menuitem", { name: "Renombrar" }).click();
  await page.fill("#prompt-input", "Sarcómero");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("link", { name: "Sarcómero" }).first()).toBeVisible();
  await page.getByRole("button", { name: /Opciones de la página Sarcómero/ }).first().click();
  await page.getByRole("menuitem", { name: "Mover a…" }).click();
  await page.selectOption("#move-sec", { label: "Fisiología muscular" });
  await page.getByRole("button", { name: "Mover", exact: true }).click();
  const muscular = page.locator("section").filter({ has: page.getByRole("heading", { name: "Fisiología muscular" }) });
  await expect(muscular.getByRole("link", { name: "Sarcómero" })).toBeVisible();
});

test("sin conexión: los cambios no se pierden y se guardan al reconectar", async ({ page, context }) => {
  await register(page);
  await newNotebook(page, "Anatomía");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Primer párrafo guardado.");
  await waitSaved(page);
  await context.setOffline(true);
  await page.keyboard.type(" Texto escrito sin conexión.");
  await expect(page.getByText(/Sin conexión|No se pudo guardar/).first()).toBeVisible({ timeout: 15_000 });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitSaved(page);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("Texto escrito sin conexión.");
});

test("conflicto entre dos dispositivos: se avisa y se puede elegir la versión", async ({ browser }) => {
  const a = await browser.newContext();
  const pa = await a.newPage();
  await register(pa);
  await newNotebook(pa, "Histología");
  const url = pa.url();
  const b = await browser.newContext({ storageState: await a.storageState() });
  const pb = await b.newPage();
  await pb.goto(url);
  await pb.waitForSelector(".ProseMirror");
  // A guarda primero
  await pa.locator(".ProseMirror").click();
  await pa.keyboard.type("Escrito en el portátil.");
  await waitSaved(pa);
  // B, con una versión antigua, también escribe → conflicto
  await pb.locator(".ProseMirror").click();
  await pb.keyboard.type("Escrito en el iPad.");
  await expect(pb.getByRole("dialog", { name: "Esta página cambió en otro dispositivo" })).toBeVisible({ timeout: 15_000 });
  await pb.getByRole("button", { name: "Mantener la mía" }).click();
  await waitSaved(pb);
  await pa.reload();
  await expect(pa.locator(".ProseMirror")).toContainText("Escrito en el iPad.");
  await a.close();
  await b.close();
});

test("otro usuario no puede abrir ni exportar mis apuntes", async ({ browser }) => {
  const a = await browser.newContext();
  const pa = await a.newPage();
  await register(pa);
  await newNotebook(pa, "Privado");
  await pa.locator(".ProseMirror").click();
  await pa.keyboard.type("Contenido confidencial de A.");
  await waitSaved(pa);
  const url = pa.url();
  const id = url.split("/").pop();
  const b = await browser.newContext();
  const pb = await b.newPage();
  await register(pb);
  expect((await pb.goto(url))?.status()).toBe(404);
  expect((await pb.request.get(`/api/notes/pages/${id}`)).status()).toBe(404);
  expect((await pb.request.get(`/api/notes/pages/${id}/export?format=txt`)).status()).toBe(404);
  await a.close();
  await b.close();
});

test("estudiar desde una página vinculada a un libro (búsqueda local, sin IA)", async ({ page }) => {
  await loginDemo(page);
  await newNotebook(page, `Fisio demo ${Date.now()}`);
  await page.fill("#page-title", "Calcio y troponina");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("El calcio liberado por RyR1 se une a la troponina C y la tropomiosina deja libre la actina.");
  await waitSaved(page);
  await page.getByRole("button", { name: "Libro de referencia" }).click();
  const panel = page.getByRole("complementary", { name: "Libro" });
  await panel.locator("#link-doc").selectOption({ label: "Contracción del músculo esquelético (demo)" });
  await expect(panel.getByRole("link", { name: "Contracción del músculo esquelético (demo)" })).toBeVisible();
  // Consultar el libro sin salir del editor e insertar una cita con su página
  await panel.locator("#ref-q").fill("troponina calcio");
  await panel.getByRole("button", { name: "Buscar" }).click();
  await expect(panel.getByText(/pág\. 2/).first()).toBeVisible();
  await panel.getByRole("button", { name: "Insertar cita" }).first().click();
  await expect(page.locator(".ProseMirror blockquote")).toContainText("pág. 2");
  // Crear preguntas del libro (reutiliza conceptos validados, sin IA) y estudiar
  await page.getByRole("button", { name: "Estudiar esta página" }).first().click();
  const study = page.getByRole("complementary", { name: "Estudiar" });
  await study.getByRole("radio", { name: "El libro" }).click();
  await study.getByRole("button", { name: "Crear preguntas" }).click();
  await expect(study.getByText(/del libro/)).toBeVisible({ timeout: 20_000 });
  await expect(study.getByText(/reutilizadas/)).toBeVisible();
  await study.getByRole("button", { name: "Estudiar esta página" }).click();
  await page.waitForURL(/\/app\/study\//);
  await expect(page.getByRole("button", { name: /Comprobar/ }).first()).toBeVisible();
});
