import { authedRoute, readJson, json } from "@/server/http";
import { deleteLibrary, updateLibrary } from "@/server/documents/service";
import { run } from "@/server/route-errors";

export const PATCH = authedRoute<{ id: string }>(async (req, user, { id }) => json({ library: await run(async () => updateLibrary(user.id, id, await readJson(req))) }));
export const DELETE = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => deleteLibrary(user.id, id));
  return json({ ok: true });
});
