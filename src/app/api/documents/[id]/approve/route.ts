import { authedRoute, json } from "@/server/http";
import { approveReportAndBuild } from "@/server/verification/review";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => approveReportAndBuild(user.id, id));
  return json({ ok: true });
});
