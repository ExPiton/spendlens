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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS is terminated by the reverse proxy in front of this
          // container; safe to send unconditionally since a plain-HTTP
          // deployment never has a way to see this header take effect.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
