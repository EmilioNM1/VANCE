import { authedRoute, json } from "@/server/http";
import { duplicatePage } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (_req, user, { id }) => json({ page: await run(() => duplicatePage(user.id, id)) }, 201));
