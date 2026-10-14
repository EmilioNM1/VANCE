import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

declare global {
  // eslint-disable-next-line no-var
  var __vancePool: Pool | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  return new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
}

export function getPool(): Pool {
  if (!globalThis.__vancePool) globalThis.__vancePool = createPool();
  return globalThis.__vancePool;
}

let _db: DB | undefined;
export function getDb(): DB {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

/** Solo para pruebas: reinicia el pool hacia otra base de datos. */
export async function resetDbForTests(url: string) {
  if (globalThis.__vancePool) await globalThis.__vancePool.end();
  globalThis.__vancePool = new Pool({ connectionString: url, max: 5 });
  _db = drizzle(globalThis.__vancePool, { schema });
}

/**
 * Ejecuta `fn` en una transacción con `app.user_id` fijado, de modo que las políticas
 * Row Level Security de PostgreSQL limiten todas las consultas a los datos de ese usuario.
 * Es la ÚNICA vía para acceder a tablas de contenido de usuario.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("userId inválido");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export { schema };
