import { authedRoute, readJson, json } from "@/server/http";
import { deleteNotebook, getNotebookTree, updateNotebook } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => json(await run(() => getNotebookTree(user.id, id))));
export const PATCH = authedRoute<{ id: string }>(async (req, user, { id }) => json({ notebook: await run(async () => updateNotebook(user.id, id, await readJson(req))) }));
export const DELETE = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => deleteNotebook(user.id, id));
  return json({ ok: true });
});
