import { authedRoute, readJson, json } from "@/server/http";
import { deletePage, getPage, savePage, updatePageMeta } from "@/server/notebooks/service";
import { conflictResponse, run } from "@/server/route-errors";
import { rateLimit } from "@/server/rate-limit";
import { HttpError } from "@/server/http";

export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => json(await run(() => getPage(user.id, id))));
/** Guardado automático (contenido y/o título) con control de versión. */
export const PUT = authedRoute<{ id: string }>(async (req, user, { id }) => {
  if (!rateLimit(`save:${user.id}`, 1200, 60 * 60_000)) throw new HttpError(429, "Demasiados guardados en poco tiempo; se reintentará.");
  const body = await readJson(req);
  try {
    return json(await run(() => savePage(user.id, id, body)));
  } catch (e) {
    const c = conflictResponse(e);
    if (c) return c;
    throw e;
  }
});
export const PATCH = authedRoute<{ id: string }>(async (req, user, { id }) => json(await run(async () => updatePageMeta(user.id, id, await readJson(req)))));
export const DELETE = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  await run(() => deletePage(user.id, id));
  return json({ ok: true });
});
