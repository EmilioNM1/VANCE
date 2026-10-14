import { authedRoute, readJson, json } from "@/server/http";
import { updateProfile } from "@/server/account";

export const PATCH = authedRoute(async (req, user) => {
  await updateProfile(user.id, await readJson(req));
  return json({ ok: true });
});
