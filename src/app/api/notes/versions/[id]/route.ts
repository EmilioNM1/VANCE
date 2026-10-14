import { authedRoute, json } from "@/server/http";
import { getVersion } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => json({ version: await run(() => getVersion(user.id, id)) }));
