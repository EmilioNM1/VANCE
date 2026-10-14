import { authedRoute } from "@/server/http";
import { readAsset } from "@/server/notebooks/service";
import { run } from "@/server/route-errors";

/** Imágenes privadas: solo las ve su propietario (sesión obligatoria). */
export const GET = authedRoute<{ id: string }>(async (_req, user, { id }) => {
  const a = await run(() => readAsset(user.id, id));
  return new Response(new Uint8Array(a.data), { headers: { "Content-Type": a.mimeType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});
