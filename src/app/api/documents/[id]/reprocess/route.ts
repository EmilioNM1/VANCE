import { z } from "zod";
import { authedRoute, readJson, json } from "@/server/http";
import { reprocessDocument } from "@/server/documents/service";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => {
  const { stage } = z.object({ stage: z.enum(["extract", "audit", "knowledge"]) }).parse(await readJson(req));
  await run(() => reprocessDocument(user.id, id, stage));
  return json({ ok: true });
});
