import sharp from "sharp";
import path from "node:path";
import { writeFileSync } from "node:fs";

/**
 * Renders the social-share card (Open Graph / X "summary_large_image",
 * 1200×630) to `src/app/opengraph-image.png`, which Next.js picks up through
 * the `opengraph-image` file convention. Same approach and palette as
 * `generate-x-assets.ts`; re-run after a brand or copy change:
 *
 *   npx tsx scripts/generate-og-image.ts
 */
const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const INK = "#121614";
const PAPER = "#f6f6f5";
const MUTED = "#8f9690";
const SIGNAL = "#3bdf7a";
const HELD = "#f2b544";
const CRITICAL = "#ff6b5e";

function chip(x: number, y: number, dot: string, label: string, width: number): string {
  return `
    <g transform="translate(${x}, ${y})">
      <rect width="${width}" height="44" rx="8" fill="#1b211e" stroke="#2a312d" />
      <circle cx="22" cy="22" r="5" fill="${dot}" />
      <text x="38" y="28" font-family="${MONO}" font-size="17" fill="${PAPER}">${label}</text>
    </g>`;
}

async function main() {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
    <rect width="1200" height="630" fill="${INK}" />
    <circle cx="1080" cy="120" r="330" fill="none" stroke="#1b211e" stroke-width="40" />

    <g transform="translate(80, 72) scale(0.56)">
      <circle cx="50" cy="50" r="36" fill="none" stroke="${PAPER}" stroke-width="12" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="${SIGNAL}" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="155.38 226.19" transform="rotate(-90 50 50)" />
      <circle cx="50" cy="50" r="7" fill="${PAPER}" />
    </g>
    <text x="150" y="113" font-family="${FONT}" font-size="36" letter-spacing="-0.02em" fill="${PAPER}">
      <tspan font-weight="600">spend</tspan><tspan font-weight="400">lens</tspan>
    </text>

    <text x="80" y="222" font-family="${FONT}" font-size="20" font-weight="500" letter-spacing="0.12em" fill="${SIGNAL}">SPEND OVERSIGHT FOR AI AGENTS ON ARC</text>
    <text font-family="${FONT}" font-size="58" font-weight="600" letter-spacing="-0.025em" fill="${PAPER}">
      <tspan x="80" y="300">Circle built the payment rail.</tspan>
      <tspan x="80" y="370">We show you what’s actually</tspan>
      <tspan x="80" y="440">happening on it.</tspan>
    </text>

    ${chip(80, 510, SIGNAL, "allowed", 150)}
    ${chip(246, 510, CRITICAL, "blocked · allowlist", 250)}
    ${chip(512, 510, HELD, "held · waiting for you", 285)}
    <text x="1120" y="540" text-anchor="end" font-family="${MONO}" font-size="18" fill="${MUTED}">spendlens.com.tr</text>
  </svg>`;

  const out = path.join(process.cwd(), "src", "app", "opengraph-image.png");
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
  writeFileSync(
    path.join(process.cwd(), "src", "app", "opengraph-image.alt.txt"),
    "Spendlens: spend oversight for AI agents on Arc. Every payment is allowed, blocked or held before it is signed.",
  );
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
