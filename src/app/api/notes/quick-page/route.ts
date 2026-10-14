import { authedRoute, json } from "@/server/http";
import { quickCreatePage } from "@/server/notebooks/service";

export const POST = authedRoute(async (_req, user) => json({ page: await quickCreatePage(user.id) }, 201));
