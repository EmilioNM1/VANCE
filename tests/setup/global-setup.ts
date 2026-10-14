import { Pool } from "pg";
import { runMigrations } from "../../src/db/migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://vance:vance@localhost:5432/vance_test";
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await pool.end();
  await runMigrations(url);
}
