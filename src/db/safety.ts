import { sql } from "drizzle-orm";
import { getDb } from "./client";

/**
 * Comprueba que el rol de conexión no puede saltarse Row Level Security.
 * Un superusuario o un rol con BYPASSRLS ignora las políticas aunque estén forzadas.
 */
export async function checkRlsEffective(): Promise<{ ok: boolean; role: string }> {
  const r = await getDb().execute(sql`select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
  const row = r.rows[0] as { role: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
  return { ok: !!row && !row.rolsuper && !row.rolbypassrls, role: row?.role ?? "?" };
}

export async function warnIfRlsBypassed() {
  try {
    const r = await checkRlsEffective();
    if (!r.ok)
      console.error(
        `\n[seguridad] El rol de base de datos "${r.role}" es superusuario o tiene BYPASSRLS: las políticas Row Level Security NO se aplican.\n` +
          `Conecta la aplicación con un rol sin privilegios (ver scripts/init-db.sql). El filtrado por usuario de la aplicación sigue activo.\n`,
      );
  } catch {
    /* la base de datos puede no estar lista todavía */
  }
}
