import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, isResponse } from "@/lib/auth/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getPolicyBySlug, parsePolicyYaml } from "@/lib/db/policy";
import { policyHash } from "@/lib/policy-hash";
import { ARC } from "@/lib/arc";
import type { PolicyConfig } from "@/lib/contracts";

/**
 * What a running guard needs from the dashboard, polled by the SDK's
 * `ControlPlane` (API-key auth): the kill-switch state of its agent, and the
 * agent's current policy so an edit in the dashboard applies without a
 * redeploy. The policy is re-derived from the stored YAML, so rows saved by
 * an older schema version still come back in the current shape.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = await requireApiKey(request);
  if (isResponse(key)) return key;

  // The SDK polls every ~15s; 120/min per key leaves room for bursts.
  const limited = await enforceRateLimit(`sdk-config:${key.keyId}`, 120);
  if ("response" in limited) return limited.response;

  try {
    const stored = await getPolicyBySlug(key.userId, key.agentSlug);
    let policy: { version: number; hash: string; config: PolicyConfig } | null = null;
    if (stored) {
      let config: PolicyConfig;
      try {
        config = parsePolicyYaml(stored.raw).config;
      } catch {
        config = stored.config;
      }
      policy = { version: stored.version, hash: policyHash(config), config };
    }

    return NextResponse.json(
      {
        agent: { id: key.agentSlug, status: key.agentStatus },
        policy,
        arc: { network: ARC.network, chainId: ARC.chainId },
      },
      {
        headers: {
          ...limited.headers,
          "cache-control": "no-store",
          "x-spendlens-agent-status": key.agentStatus,
        },
      },
    );
  } catch (err) {
    console.error("[spendlens] GET /api/sdk/config failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
