import { authedRoute, readJson, json } from "@/server/http";
import { deleteDocument, updateDocumentMeta } from "@/server/documents/service";
import { run } from "@/server/route-errors";

export const PATCH = authedRoute<{ id: string }>(async (req, user, { id }) => json({ document: await run(async () => updateDocumentMeta(user.id, id, await readJson(req))) }));
export const DELETE = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => deleteDocument(user.id, id));
  return json({ ok: true });
});
