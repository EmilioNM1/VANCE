import { authedRoute, json } from "@/server/http";
import { getLatestReview } from "@/server/notes-intelligence/analyze";
import { getPage } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => getPage(user.id, id));
  return json(await getLatestReview(user.id, id));
});
