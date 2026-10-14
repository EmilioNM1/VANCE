import { authedRoute, json } from "@/server/http";
import { getJobForUser } from "@/server/notes-intelligence/jobs";
import { run } from "@/server/route-errors";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => json(await run(() => getJobForUser(user.id, id))));
