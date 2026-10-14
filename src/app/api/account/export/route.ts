import { authedRoute } from "@/server/http";
import { exportUserData } from "@/server/account";

export const GET = authedRoute(async (_req, user) => {
  const data = await exportUserData(user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="vance-datos-${new Date().toISOString().slice(0, 10)}.json"` },
  });
});
