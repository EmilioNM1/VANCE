import { authedRoute, readJson, json } from "@/server/http";
import { reorderNotebooks } from "@/server/notebooks/service";

export const POST = authedRoute(async (req, user) => {
  await reorderNotebooks(user.id, ((await readJson(req)) as { ids?: unknown }).ids);
  return json({ ok: true });
});
