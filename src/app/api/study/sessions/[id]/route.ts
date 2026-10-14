import { authedRoute, json } from "@/server/http";
import { getSessionView } from "@/server/study/session";
import { run } from "@/server/route-errors";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => json(await run(() => getSessionView(user.id, id))));
