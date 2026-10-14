import { authedRoute, json } from "@/server/http";
import { endSession } from "@/server/study/session";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => endSession(user.id, id));
  return json({ ok: true });
});
