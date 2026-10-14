import { authedRoute, json } from "@/server/http";
import { listVersions } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => json({ versions: await run(() => listVersions(user.id, id)) }));
