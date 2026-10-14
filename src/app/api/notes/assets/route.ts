import { authedRoute, json, HttpError } from "@/server/http";
import { saveAsset } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";
import { rateLimit } from "@/server/rate-limit";

export const POST = authedRoute(async (req, user) => {
  if (!rateLimit(`asset:${user.id}`, 200, 60 * 60_000)) throw new HttpError(429, "Demasiadas imágenes en poco tiempo.");
  const form = await req.formData();
  const file = form.get("file");
  const pageId = String(form.get("pageId") ?? "") || null;
  if (!(file instanceof File)) throw new HttpError(400, "No se recibió la imagen.");
  if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "La imagen supera 10 MB.");
  return json(await run(async () => saveAsset(user.id, pageId, Buffer.from(await file.arrayBuffer()))), 201);
});
