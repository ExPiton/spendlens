/**
 * Next.js startup hook. In the Docker image (`RUN_MIGRATIONS_ON_BOOT=true`)
 * this applies pending DB migrations before the server accepts traffic. For
 * local dev, run `npm run db:migrate` yourself instead.
 */
export async function register(): Promise<void> {
  if (
    process.env.RUN_MIGRATIONS_ON_BOOT === "true" &&
    process.env.NEXT_RUNTIME === "nodejs"
  ) {
    const { runMigrations } = await import("@/lib/db/migrate");
    await runMigrations();
  }
}
