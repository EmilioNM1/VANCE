import { authedRoute, HttpError } from "@/server/http";
import { getPage, readAsset } from "@/server/notebooks/service";
import { exportDocx, exportMarkdown, exportPdf, exportText } from "@/server/notebooks/export";
import { run } from "@/server/route-errors";

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
} as const;

export const GET = authedRoute<{ id: string }>(async (req, user, { id }) => {
  const format = req.nextUrl.searchParams.get("format") as keyof typeof TYPES;
  if (!(format in TYPES)) throw new HttpError(400, "Formato no válido (docx, pdf, md, txt).");
  const { page } = await run(() => getPage(user.id, id));
  const load = async (assetId: string) => (/^[0-9a-f-]{36}$/i.test(assetId) ? readAsset(user.id, assetId).catch(() => null) : null);
  const body =
    format === "docx" ? await exportDocx(page.content, page.title, load) : format === "pdf" ? await exportPdf(page.content, page.title, load) : format === "md" ? exportMarkdown(page.content, page.title) : exportText(page.content, page.title);
  const safe = page.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "apuntes";
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safe)}.${format}"; filename*=UTF-8''${encodeURIComponent(safe)}.${format}`,
      "Cache-Control": "no-store",
    },
  });
});
