import { z } from "zod";
import { authedRoute, readJson, json } from "@/server/http";
import { editChunk } from "@/server/documents/service";
import { run } from "@/server/route-errors";

export const PATCH = authedRoute<{ id: string }>(async (req, user, { id }) => {
  const { editedText } = z.object({ editedText: z.string().nullable() }).parse(await readJson(req));
  return json({ chunk: await run(() => editChunk(user.id, id, editedText)) });
});
