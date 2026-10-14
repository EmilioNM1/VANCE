import { expect, test } from "@playwright/test";
import { createLibrary, register, upload } from "./helpers";
import { makePdf } from "../helpers/pdf";

test("subir un texto: se extrae y, sin IA, la verificación queda pendiente (sin inventar resultados)", async ({ page }) => {
  await register(page);
  await createLibrary(page, "Bioquímica");
  await upload(page, { name: "glucolisis.md", mimeType: "text/markdown", buffer: Buffer.from("# Glucólisis\n\nLa glucólisis convierte una molécula de glucosa en dos de piruvato.\n\n## Balance\nSe obtienen dos ATP netos por glucosa.") });
  await expect(page.getByText("Texto extraído").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/requiere IA/)).toBeVisible();
  await expect(page.getByText(/^Página \d+$/)).toHaveCount(0); // markdown sin paginación
  await expect(page.getByText("La glucólisis convierte una molécula")).toBeVisible();
  // Corregir un error de extracción conservando el original
  await page.getByRole("button", { name: "Corregir extracción" }).first().click();
  await page.locator("textarea").first().fill("La glucólisis convierte una molécula de glucosa en dos moléculas de piruvato.");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Corregido por ti")).toBeVisible();
});

test("un PDF escaneado sin texto muestra un error claro", async ({ page }) => {
  await register(page);
  await createLibrary(page, "Apuntes escaneados");
  await upload(page, { name: "escaneado.pdf", mimeType: "application/pdf", buffer: makePdf([[], []]) });
  await expect(page.getByText("El procesamiento no pudo completarse")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/no contiene texto extraíble/)).toBeVisible();
});

test("se rechaza un archivo con formato no permitido", async ({ page }) => {
  await register(page);
  await createLibrary(page, "Varios");
  await page.setInputFiles("input[type=file]", { name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("esto no es un pdf") });
  await page.check("input[type=checkbox]");
  await page.click("text=Subir y procesar");
  await expect(page.getByText("El archivo no es un PDF válido.")).toBeVisible();
});

test("un usuario no puede ver el documento de otro", async ({ browser }) => {
  const a = await browser.newContext();
  const pa = await a.newPage();
  await register(pa, "Propietario");
  await createLibrary(pa, "Privada");
  await upload(pa, { name: "privado.txt", mimeType: "text/plain", buffer: Buffer.from("Contenido privado del usuario A sobre la mitosis celular.") });
  const docUrl = pa.url();
  const docId = docUrl.split("/").pop()!;
  const b = await browser.newContext();
  const pb = await b.newPage();
  await register(pb, "Intruso");
  const res = await pb.goto(docUrl);
  expect(res?.status()).toBe(404);
  await expect(pb.getByText("Contenido privado")).toHaveCount(0);
  const api = await pb.request.get(`/api/documents/${docId}/status`);
  expect(api.status()).toBe(404);
  const del = await pb.request.delete(`/api/documents/${docId}`, { headers: { origin: new URL(docUrl).origin } });
  expect(del.status()).toBe(404);
  await pa.reload();
  await expect(pa.getByText("Contenido privado del usuario A")).toBeVisible();
  await a.close();
  await b.close();
});
