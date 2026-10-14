import { authedRoute, json } from "@/server/http";
import { duplicateNotebook } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (_req, user, { id }) => json({ notebook: await run(() => duplicateNotebook(user.id, id)) }, 201));
