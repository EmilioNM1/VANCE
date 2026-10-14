import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, getPool, withUser } from "@/db/client";
import { documents, libraries, users } from "@/db/schema";
import { createLibrary, deleteLibrary, editChunk, getLibrary, listDocuments, NotFoundError, updateLibrary } from "@/server/documents/service";
import { decideClaim } from "@/server/verification/review";
import { getSessionView, requestHint, submitAttempt } from "@/server/study/session";
import { deleteAccount } from "@/server/account";
import { makeUser } from "../helpers/db";

const randomId = "00000000-0000-4000-8000-000000000000";

describe("aislamiento de datos entre usuarios", () => {
  it("Row Level Security: sin usuario fijado no se ve nada; con otro usuario tampoco", async () => {
    const a = await makeUser("A");
    const b = await makeUser("B");
    const lib = await createLibrary(a.id, { name: "Privada de A" });
    // Consulta directa sin app.user_id → 0 filas (fallo seguro)
    const raw = await getPool().query("select * from libraries where id = $1", [lib.id]);
    expect(raw.rowCount).toBe(0);
    // Con el usuario B fijado → 0 filas aunque se busque por id
    const asB = await withUser(b.id, (tx) => tx.select().from(libraries).where(eq(libraries.id, lib.id)));
    expect(asB).toHaveLength(0);
    // B no puede insertar filas a nombre de A
    const err = await withUser(b.id, (tx) => tx.insert(libraries).values({ userId: a.id, name: "intrusa" })).catch((e) => e);
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/row-level security/);
    // B no puede modificar ni borrar la biblioteca de A
    await expect(updateLibrary(b.id, lib.id, { name: "hack" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteLibrary(b.id, lib.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getLibrary(b.id, lib.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getLibrary(a.id, lib.id)).library.name).toBe("Privada de A");
    expect(await listDocuments(b.id)).toHaveLength(0);
  });

  it("los recursos ajenos o inexistentes devuelven 'no encontrado' en todas las operaciones", async () => {
    const b = await makeUser("B2");
    await expect(editChunk(b.id, randomId, "x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(decideClaim(b.id, randomId, { decision: "REJECTED" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSessionView(b.id, randomId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestHint(b.id, randomId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitAttempt(b.id, randomId, { response: { text: "x" } })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("withUser rechaza identificadores no válidos (evita inyección en set_config)", async () => {
    await expect(withUser("x'; drop table users; --", async () => 1)).rejects.toThrow(/userId inválido/);
  });

  it("eliminar la cuenta borra en cascada todos los datos del usuario", async () => {
    const a = await makeUser("Borrable");
    const lib = await createLibrary(a.id, { name: "L" });
    await withUser(a.id, (tx) =>
      tx.insert(documents).values({ userId: a.id, libraryId: lib.id, title: "d", originalFilename: "d.txt", mimeType: "text/plain", sizeBytes: 1, sha256: "x", storageKey: `${a.id}/${randomId}`, rightsConfirmedAt: new Date() }),
    );
    await expect(deleteAccount(a.id, "mala")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await deleteAccount(a.id, "contraseña-segura-123");
    expect(await getDb().select().from(users).where(eq(users.id, a.id))).toHaveLength(0);
    // Comprobación como superusuario lógico: contar filas con RLS desactivado no es posible para la app;
    // usamos el propio usuario (ya inexistente) para verificar que no queda nada visible.
    const left = await withUser(a.id, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(documents));
    expect(left[0]!.n).toBe(0);
  });
});
