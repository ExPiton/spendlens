/** Local / CI migration runner. In production the container runs the same
 *  logic from `instrumentation.register()`. */
import { readFileSync } from "node:fs";
import { runMigrations } from "../src/lib/db/migrate";

function loadDotEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // rely on ambient env
  }
}

loadDotEnv();

runMigrations().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
