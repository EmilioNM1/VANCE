import { authedRoute, json, HttpError } from "@/server/http";
import { createDocumentFromUpload, uploadMetaSchema } from "@/server/documents/service";
import { maxUploadBytes } from "@/server/documents/file-validation";
import { run } from "@/server/route-errors";
import { rateLimit } from "@/server/rate-limit";

export const POST = authedRoute(async (req, user) => {
  if (!rateLimit(`upload:${user.id}`, 30, 60 * 60_000)) throw new HttpError(429, "Has subido demasiados archivos en poco tiempo.");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxUploadBytes() + 1024 * 1024) throw new HttpError(413, "El archivo supera el tamaño máximo permitido.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No se ha recibido ningún archivo.");
  const meta = uploadMetaSchema.parse({
    libraryId: form.get("libraryId"),
    title: form.get("title") || undefined,
    topic: form.get("topic") || undefined,
    rightsConfirmed: form.get("rightsConfirmed") === "true",
  });
  const data = Buffer.from(await file.arrayBuffer());
  const doc = await run(() => createDocumentFromUpload(user.id, meta, { name: file.name, data }));
  return json({ document: { id: doc.id, status: doc.status } }, 201);
});
