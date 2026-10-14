import { authedRoute, readJson, json } from "@/server/http";
import { createNotebook, listNotebooks } from "@/server/notebooks/service";

export const GET = authedRoute(async (_req, user) => json({ notebooks: await listNotebooks(user.id) }));
export const POST = authedRoute(async (req, user) => json(await createNotebook(user.id, await readJson(req)), 201));
