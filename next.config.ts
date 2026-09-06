import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the workspace root to this repo — without it, Turbopack walks up
  // and can latch onto an unrelated lockfile higher in the home directory
  // (harmless, but it prints a warning on every build).
  turbopack: {
    root: path.join(__dirname),
  },
  // Emit a self-contained server bundle (`.next/standalone`) so the Docker
  // image can run `node server.js` without a full `node_modules` tree.
  output: "standalone",
  // Keep these out of the bundle — they use dynamic requires / native bits
  // that don't survive bundling.
  serverExternalPackages: ["nodemailer", "postgres"],
};

export default nextConfig;
