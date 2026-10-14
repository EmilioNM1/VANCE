import { authedRoute, json, HttpError } from "@/server/http";
import { getPage } from "@/server/notebooks/service";
import { retrievePassages } from "@/server/retrieval";
import { searchLocal } from "@/server/retrieval/local";
import { run } from "@/server/route-errors";
import { rateLimit } from "@/server/rate-limit";

/**
 * Consulta el libro desde el editor. Por defecto usa la búsqueda local (gratuita y con página exacta);
 * con semantic=1 usa Gemini File Search si está configurado.
 */
export const GET = authedRoute<{ id: string }>(async (req, user, { id }) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 500);
  const semantic = req.nextUrl.searchParams.get("semantic") === "1";
  const docParam = req.nextUrl.searchParams.get("documentId");
  if (q.trim().length < 2) return json({ passages: [], provider: "none" });
  if (!rateLimit(`booksearch:${user.id}`, 300, 60 * 60_000)) throw new HttpError(429, "Demasiadas búsquedas seguidas.");
  const { linkedDocuments } = await run(() => getPage(user.id, id));
  const ids = docParam ? [docParam].filter((d) => linkedDocuments.some((l) => l.id === d)) : linkedDocuments.map((d) => d.id);
  if (semantic) return json(await retrievePassages(user.id, q, { documentIds: ids.length ? ids : undefined, limit: 8 }));
  return json({ passages: await searchLocal(user.id, q, ids.length ? ids : null, 10), provider: "local" });
});
