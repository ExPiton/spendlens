/**
 * Runs after `tsup` (see `npm run build:sdk`). Writes the SDK package
 * manifest, copies the bundled types next to the single-file build, and
 * tarballs the package — all into `public/downloads/` so the app serves them.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sdkDist = path.join(root, "sdk-dist");
const downloads = path.join(root, "public", "downloads");
mkdirSync(downloads, { recursive: true });

const rootPkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = rootPkg.version || "0.1.0";
const pick = (name) => ({ [name]: rootPkg.dependencies[name] });

const pkg = {
  name: "@spendlens/sdk",
  version,
  description: "Interception SDK for Spendlens — policy, ledger and quality analysis for AI-agent micropayments.",
  type: "module",
  main: "./index.js",
  module: "./index.mjs",
  types: "./index.d.ts",
  exports: {
    ".": {
      types: "./index.d.ts",
      import: "./index.mjs",
      require: "./index.js",
    },
  },
  files: ["index.mjs", "index.js", "index.d.ts", "index.d.mts", "README.md", "LICENSE"],
  license: rootPkg.license || "MIT",
  engines: { node: ">=20.16" },
  repository: { type: "git", url: "git+https://github.com/Expiyon/spendlens.git" },
  homepage: "https://github.com/Expiyon/spendlens#readme",
  keywords: ["x402", "nanopayments", "circle", "arc", "usdc", "ai-agents", "policy", "audit"],
  publishConfig: { access: "public", provenance: true },
  dependencies: {
    ...pick("zod"),
    ...pick("js-yaml"),
    ...pick("@noble/curves"),
    ...pick("@noble/hashes"),
  },
};
writeFileSync(path.join(sdkDist, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

writeFileSync(
  path.join(sdkDist, "README.md"),
  [
    "# @spendlens/sdk",
    "",
    "```ts",
    'import { guard, createLocalSigner } from "@spendlens/sdk";',
    "",
    "const pay = guard({",
    '  agentId: "research-crawler-01",',
    '  policy: "./policy.yaml",                  // YAML text, a file path, or omit to follow the dashboard',
    "  signer: createLocalSigner(process.env.AGENT_PRIVATE_KEY),  // required on Arc mainnet",
    "});",
    "",
    'const res = await pay.fetch("https://api.example.io/v1/data", { taskId: "task-1" });',
    "```",
    "",
    "For Circle Nanopayments on Arc use `guardGateway(new GatewayClient({ chain: ARC_GATEWAY_CHAIN, privateKey, rpcUrl: ARC.rpcUrl }), { agentId })`.",
    "",
    "- `SPENDLENS_URL` + `SPENDLENS_API_KEY` (env) connect the guard to your dashboard: telemetry, the",
    "  kill switch (a halted agent is blocked before signing), and live policy updates.",
    "- Arc mainnet (`ARC_NETWORK=mainnet`): a policy and a real signer are mandatory; the",
    "  permissive default and the mock signature are testnet-only.",
    "- Self-hosted: `sink: createSqliteLedger(\"./ledger.db\").sink` keeps an append-only SQLite ledger.",
    "",
  ].join("\n"),
);

copyFileSync(path.join(root, "LICENSE"), path.join(sdkDist, "LICENSE"));

// bundled types alongside the single-file build
copyFileSync(path.join(sdkDist, "index.d.ts"), path.join(downloads, "spendlens-sdk.d.ts"));

// tarball
for (const f of readdirSync(downloads)) {
  if (/^spendlens-sdk-.*\.tgz$/.test(f)) rmSync(path.join(downloads, f));
}
const out = execFileSync("npm", ["pack", sdkDist, "--pack-destination", downloads], {
  encoding: "utf8",
});
const tgz = out.trim().split("\n").pop();
// stable name too
copyFileSync(path.join(downloads, tgz), path.join(downloads, "spendlens-sdk.tgz"));

console.log(`[pack-sdk] wrote public/downloads/{spendlens-sdk.mjs, spendlens-sdk.d.ts, spendlens-sdk.tgz (${tgz})}`);
