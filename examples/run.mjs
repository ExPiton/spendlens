/**
 * `npm run example` — starts the throwaway paid API, runs the example agent
 * against it through Spendlens, then shuts the API down.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sdk = path.join(dir, "..", "public", "downloads", "spendlens-sdk.mjs");

if (!existsSync(sdk)) {
  console.error("SDK bundle missing — run `npm run build:sdk` first.");
  process.exit(1);
}

const api = spawn(process.execPath, [path.join(dir, "paid-api.mjs")], { stdio: "inherit" });

await new Promise((r) => setTimeout(r, 700));

const agent = spawn(process.execPath, [path.join(dir, "agent.mjs")], { stdio: "inherit" });

agent.on("exit", (code) => {
  api.kill();
  process.exit(code ?? 0);
});
