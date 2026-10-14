import { authedRoute, readJson, json } from "@/server/http";
import { decideClaim } from "@/server/verification/review";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => json({ claim: await run(async () => decideClaim(user.id, id, await readJson(req))) }));
