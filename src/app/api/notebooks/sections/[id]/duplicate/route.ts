import { authedRoute, json } from "@/server/http";
import { duplicateSection } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

export const POST = authedRoute<{ id: string }>(async (_req, user, { id }) => json({ section: await run(() => duplicateSection(user.id, id)) }, 201));
