import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import type { EscalationView } from "@/lib/db/escalations";

/**
 * Operator-facing notifications. Delivery goes through the same provider as
 * auth mail (Resend / SMTP); with none configured in development the message
 * is logged instead. Every alert is also mirrored to `ALERT_WEBHOOK_URL`
 * when set (Slack/PagerDuty-style JSON), so a missed inbox isn't the only
 * path for a key-leak signal.
 */

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const usdc = (micro: number) => (micro / 1_000_000).toFixed(6);

async function ownerEmail(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.email ?? null;
}

async function mirrorToWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "spendlens", ...payload }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error("[spendlens] ALERT_WEBHOOK_URL delivery failed:", err);
  }
}

export interface CriticalRow {
  agentSlug: string;
  chainId: number;
  counterparty: string;
  chainAmountMicroUsdc: number;
  ledgerAmountMicroUsdc: number;
  deltaMicroUsdc: number;
}

/** Scenario C: Gateway shows spend the ledger never recorded. */
export async function notifyCriticalReconciliation(
  userId: string,
  rows: CriticalRow[],
  halted: string[],
): Promise<void> {
  if (rows.length === 0) return;
  const lines = rows.map(
    (r) =>
      `• ${r.agentSlug} → ${r.counterparty} (chain ${r.chainId}): on-chain ${usdc(r.chainAmountMicroUsdc)} USDC vs ledger ${usdc(r.ledgerAmountMicroUsdc)} USDC — ${usdc(r.deltaMicroUsdc)} USDC unrecorded`,
  );
  const haltLine = halted.length
    ? `\n\nSpendlens halted ${halted.join(", ")} automatically: their guards now block every payment before signing. Rotate the wallet key, then resume from the dashboard.`
    : "\n\nThe affected agents were NOT halted automatically (RECONCILE_AUTO_HALT=false) — halt them from the dashboard if this wasn't expected.";

  await mirrorToWebhook({
    type: "reconciliation.critical",
    userId,
    halted,
    rows,
  });
  const to = await ownerEmail(userId);
  if (!to) return;
  await sendEmail({
    to,
    subject: `[Spendlens] CRITICAL: unrecorded on-chain spend (${rows.length} counterpart${rows.length === 1 ? "y" : "ies"})`,
    heading: "Unrecorded on-chain spend detected",
    body:
      "Circle Gateway settled payments from your agent's wallet that no Spendlens-guarded call authorized. " +
      "This is the signature of a leaked signing key.\n\n" +
      lines.join("\n") +
      haltLine,
    cta: { label: "Open reconciliation", url: `${appUrl()}/dashboard/reconciliation` },
  });
}

/** A `hold` is waiting for a person. */
export async function notifyEscalation(userId: string, esc: EscalationView): Promise<void> {
  await mirrorToWebhook({ type: "escalation.pending", userId, escalation: esc });
  const to = await ownerEmail(userId);
  if (!to) return;
  await sendEmail({
    to,
    subject: `[Spendlens] Approval needed: ${esc.agentSlug} wants to pay ${usdc(esc.amountMicroUsdc)} USDC`,
    heading: "A payment is waiting for your approval",
    body:
      `Agent: ${esc.agentSlug}\nCounterparty: ${esc.counterparty}\nResource: ${esc.resource || "—"}\n` +
      `Amount: ${usdc(esc.amountMicroUsdc)} USDC\nRule: ${esc.ruleHit ?? "—"}\n\n` +
      `Decide before ${new Date(esc.expiresAt).toUTCString()} — after that the policy's on_timeout applies.`,
    cta: { label: "Review in Spendlens", url: `${appUrl()}/dashboard/approvals` },
  });
}
