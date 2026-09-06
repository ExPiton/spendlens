import { defineConfig } from "drizzle-kit";

// Load .env for local `drizzle-kit` commands (the app itself gets env from
// the platform / docker compose, not from here).
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env file — rely on the ambient environment
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://spendlens:spendlens@localhost:5432/spendlens",
  },
  strict: true,
  verbose: true,
});
