import { authedRoute, readJson, json } from "@/server/http";
import { deleteSection, updateSection } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const PATCH = authedRoute<{ id: string }>(async (req, user, { id }) => json({ section: await run(async () => updateSection(user.id, id, await readJson(req))) }));
export const DELETE = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => deleteSection(user.id, id));
  return json({ ok: true });
});
