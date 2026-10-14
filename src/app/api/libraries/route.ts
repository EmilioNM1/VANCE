import { authedRoute, readJson, json } from "@/server/http";
import { createLibrary, listLibraries } from "@/server/documents/service";

export const GET = authedRoute(async (_req, user) => json({ libraries: await listLibraries(user.id) }));
export const POST = authedRoute(async (req, user) => json({ library: await createLibrary(user.id, await readJson(req)) }, 201));
