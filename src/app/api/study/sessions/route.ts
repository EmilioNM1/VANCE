import { authedRoute, readJson, json } from "@/server/http";
import { startSession } from "@/server/study/session";
import { run } from "@/server/route-errors";

export const POST = authedRoute(async (req, user) => json(await run(async () => startSession(user.id, await readJson(req))), 201));
