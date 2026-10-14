import { z } from "zod";
import { authedRoute, readJson, json } from "@/server/http";
import { linkDocument, unlinkDocument } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

const body = z.object({ documentId: z.string().uuid() });
export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => {
  const { documentId } = body.parse(await readJson(req));
  await run(() => linkDocument(user.id, id, documentId));
  return json({ ok: true });
});
export const DELETE = authedRoute<{ id: string }>(async (req, user, { id }) => {
  const { documentId } = body.parse(await readJson(req));
  await run(() => unlinkDocument(user.id, id, documentId));
  return json({ ok: true });
});
