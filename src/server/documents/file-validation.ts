import JSZip from "jszip";

export type SupportedKind = "pdf" | "docx" | "pptx" | "txt" | "md" | "image";

export interface ValidatedFile {
  kind: SupportedKind;
  mimeType: string;
}

export class FileValidationError extends Error {}

const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;

export function maxUploadBytes() {
  return Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024;
}

/**
 * Valida tipo y contenido real del archivo (firma binaria), no solo la extensión.
 * Rechaza ejecutables, archivos vacíos, demasiado grandes y ZIP sospechosos (zip bombs).
 */
export async function validateUpload(filename: string, data: Buffer): Promise<ValidatedFile> {
  if (data.length === 0) throw new FileValidationError("El archivo está vacío.");
  if (data.length > maxUploadBytes())
    throw new FileValidationError(`El archivo supera el tamaño máximo (${process.env.MAX_UPLOAD_MB ?? 25} MB).`);
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const head = data.subarray(0, 8);

  if (ext === "pdf") {
    if (head.subarray(0, 5).toString("latin1") !== "%PDF-") throw new FileValidationError("El archivo no es un PDF válido.");
    return { kind: "pdf", mimeType: "application/pdf" };
  }
  if (ext === "docx" || ext === "pptx") {
    if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new FileValidationError("El archivo Office no es válido.");
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(data);
    } catch {
      throw new FileValidationError("El archivo Office está dañado.");
    }
    let total = 0;
    let count = 0;
    zip.forEach((_p, f) => {
      count++;
      // @ts-expect-error tamaño descomprimido declarado (no documentado en los tipos)
      total += f._data?.uncompressedSize ?? 0;
    });
    if (count > 5000 || total > MAX_UNZIPPED_BYTES) throw new FileValidationError("El archivo Office es sospechoso (demasiado grande al descomprimir).");
    if (zip.file(/vbaProject\.bin$/i).length) throw new FileValidationError("No se admiten documentos con macros.");
    const marker = ext === "docx" ? "word/document.xml" : "ppt/presentation.xml";
    if (!zip.file(marker)) throw new FileValidationError(`El archivo no es un ${ext.toUpperCase()} válido.`);
    return {
      kind: ext,
      mimeType:
        ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  }
  if (ext === "txt" || ext === "md") {
    const sample = data.subarray(0, 4096);
    if (sample.includes(0)) throw new FileValidationError("El archivo de texto contiene datos binarios.");
    return { kind: ext, mimeType: ext === "md" ? "text/markdown" : "text/plain" };
  }
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    const isPng = head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG";
    const isJpg = head[0] === 0xff && head[1] === 0xd8;
    const isWebp = data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP";
    if (isPng) return { kind: "image", mimeType: "image/png" };
    if (isJpg) return { kind: "image", mimeType: "image/jpeg" };
    if (isWebp) return { kind: "image", mimeType: "image/webp" };
    throw new FileValidationError("La imagen no es válida.");
  }
  throw new FileValidationError("Formato no admitido. Usa PDF, DOCX, PPTX, TXT, MD o imágenes (PNG, JPG, WEBP).");
}
