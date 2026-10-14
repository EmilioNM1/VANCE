import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Almacenamiento privado en disco, fuera de /public. Las claves incluyen el id de usuario
 * y un UUID aleatorio; nunca se usa el nombre original del archivo como ruta.
 * Para producción puede sustituirse por un bucket S3/Supabase Storage con la misma interfaz.
 */
function root() {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

function resolveKey(key: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(key)) throw new Error("Clave de almacenamiento no válida");
  return path.join(root(), key);
}

export async function saveFile(userId: string, data: Buffer): Promise<string> {
  const key = `${userId}/${randomUUID()}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { mode: 0o600 });
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function deleteStoredFile(key: string) {
  await rm(resolveKey(key), { force: true });
}

export async function deleteUserFiles(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return;
  await rm(path.join(root(), userId), { recursive: true, force: true });
}
