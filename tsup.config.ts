import { defineConfig } from "tsup";

/**
 * Two builds of the client SDK (`src/sdk`):
 *
 *  1. `sdk-dist/`  — an installable package (deps external). `scripts/pack-sdk.mjs`
 *     writes its package.json and tarballs it into `public/downloads/`.
 *  2. `public/downloads/spendlens-sdk.mjs` — one file with every dependency
 *     inlined, for `import ... from "./spendlens-sdk.mjs"` with zero install.
 *
 * Both are served by the running app so an agent project can grab them.
 */
export default defineConfig([
  {
    entry: { index: "src/sdk/index.ts" },
    outDir: "sdk-dist",
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: false,
    treeshake: true,
    external: ["zod", "js-yaml", "@noble/curves", "@noble/hashes"],
    tsconfig: "tsconfig.sdk.json",
  },
  {
    entry: { "spendlens-sdk": "src/sdk/index.ts" },
    outDir: "public/downloads",
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: false,
    treeshake: true,
    noExternal: [/.*/], // inline everything
    outExtension: () => ({ js: ".mjs" }),
    tsconfig: "tsconfig.sdk.json",
  },
]);
