/**
 * Public, canonical origin of the marketing site — what social cards,
 * robots.txt and the sitemap point at.
 *
 * Not APP_URL: the landing page is prerendered at `next build`, and the
 * Docker build stage has no real APP_URL (it sets a localhost placeholder),
 * so anything read from it would bake `http://localhost:3000` into the share
 * links. `NEXT_PUBLIC_SITE_URL` is inlined at build time on purpose; a
 * self-hosted deployment sets it as a build arg.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://spendlens.com.tr").replace(/\/$/, "");

export const SITE_NAME = "Spendlens";

export const SITE_DESCRIPTION =
  "Spend oversight for AI agents paying on Arc: a policy check before every payment, an append-only ledger of every decision, " +
  "quality grading of what each payment bought, and reconciliation against Circle Gateway settlements.";
