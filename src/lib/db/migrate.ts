import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies any pending SQL migrations from `./drizzle`. Called once at boot from
 * `instrumentation.register()` when `RUN_MIGRATIONS_ON_BOOT=true` (the Docker
 * image sets this). A Postgres advisory lock serialises concurrent workers so
 * only one actually runs the migration.
 */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set; cannot run migrations.");

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  try {
    await sql`SELECT pg_advisory_lock(hashtext('spendlens_migrations'))`;
    try {
      await migrate(db, { migrationsFolder: "drizzle" });
      console.log("[spendlens] migrations up to date");
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext('spendlens_migrations'))`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
