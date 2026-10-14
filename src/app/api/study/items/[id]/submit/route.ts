import { authedRoute, readJson, json, HttpError } from "@/server/http";
import { submitAttempt } from "@/server/study/session";
import { run } from "@/server/route-errors";
import { rateLimit } from "@/server/rate-limit";

export const POST = authedRoute<{ id: string }>(async (req, user, { id }) => {
  if (!rateLimit(`submit:${user.id}`, 120, 60 * 60_000)) throw new HttpError(429, "Demasiadas respuestas en poco tiempo.");
  return json(await run(async () => submitAttempt(user.id, id, await readJson(req))));
});
