import { authedRoute, json } from "@/server/http";
import { restoreVersion } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (_req, user, { id }) => json(await run(() => restoreVersion(user.id, id))));
