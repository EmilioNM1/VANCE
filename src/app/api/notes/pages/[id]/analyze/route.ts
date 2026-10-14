import { authedRoute, readJson, json } from "@/server/http";
import { requestAnalysis } from "@/server/notes-intelligence/jobs";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => json(await run(async () => requestAnalysis(user.id, id, await readJson(req))), 202));
