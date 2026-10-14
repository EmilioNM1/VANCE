import { authedRoute, json } from "@/server/http";
import { getDocument } from "@/server/documents/service";
import { run } from "@/server/route-errors";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  const d = await run(() => getDocument(user.id, id));
  return json({ status: d.status, statusDetail: d.statusDetail, error: d.error, errorCode: d.errorCode, updatedAt: d.updatedAt });
});
