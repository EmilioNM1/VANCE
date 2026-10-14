import { authedRoute, json } from "@/server/http";
import { searchPages } from "@/server/notebooks/service";

export const GET = authedRoute(async (req, user) => json({ results: await searchPages(user.id, req.nextUrl.searchParams.get("q") ?? "") }));
