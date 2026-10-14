import { authedRoute, json } from "@/server/http";
import { requestHint } from "@/server/study/session";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => requestHint(user.id, id));
  return json({ ok: true });
});
