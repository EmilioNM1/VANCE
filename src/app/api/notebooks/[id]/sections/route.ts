import { authedRoute, readJson, json } from "@/server/http";
import { createSection, reorderSections } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => json({ section: await run(async () => createSection(user.id, id, await readJson(req))) }, 201));
export const PUT = authedRoute<{ id: string }>(async (req, user, { id }) => {
  await run(async () => reorderSections(user.id, id, ((await readJson(req)) as { ids?: unknown }).ids));
  return json({ ok: true });
});
