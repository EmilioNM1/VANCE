import { authedRoute, readJson, json } from "@/server/http";
import { updateSettings } from "@/server/account";

export const PATCH = authedRoute(async (req, user) => json({ settings: await updateSettings(user.id, await readJson(req)) }));
