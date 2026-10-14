import { z } from "zod";
import { authedRoute, readJson, json } from "@/server/http";
import { bulkAcceptUnverifiable } from "@/server/verification/review";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => {
  const { claimIds } = z.object({ claimIds: z.array(z.string()) }).parse(await readJson(req));
  return json({ accepted: await run(() => bulkAcceptUnverifiable(user.id, id, claimIds)) });
});
