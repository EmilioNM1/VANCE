import { authedRoute, readJson, json } from "@/server/http";
import { createPage } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => json({ page: await run(async () => createPage(user.id, id, await readJson(req))) }, 201));
