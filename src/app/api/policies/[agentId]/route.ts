import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { YAMLException } from "js-yaml";
import { getPolicyBySlug, upsertPolicy, PolicyValidationError } from "@/lib/db/policy";
import { requireSessionUser, isResponse } from "@/lib/auth/api";

/** A validation failure is the *expected*, helpful kind of error here — the
 *  operator is actively editing YAML and needs to know which field is wrong,
 *  not "Invalid policy YAML" with no further detail (what used to show:
 *  Zod's raw `.message`, a JSON-stringified issue array dumped straight into
 *  the UI). Anything else (a DB failure, etc.) stays generic and logged
 *  server-side instead of echoed to the client. */
function describePolicyError(err: unknown): string {
  if (err instanceof PolicyValidationError) return err.message;
  if (err instanceof YAMLException) {
    // The parser's own message is precise (and carries the line); the bare
    // "Invalid policy YAML" used to be all a user with a typo got.
    const at = err.mark ? ` (line ${err.mark.line + 1}, column ${err.mark.column + 1})` : "";
    return `YAML syntax error: ${err.reason}${at}`;
  }
  if (err instanceof z.ZodError) {
    return err.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }
  console.error("[spendlens] policy save failed:", err);
  return "Invalid policy YAML";
}

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { agentId } = await props.params;
    const policy = await getPolicyBySlug(auth.userId, agentId);
    if (!policy) {
      return NextResponse.json(
        { error: `Policy not found for agent: ${agentId}` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      agentId,
      raw: policy.raw,
      config: policy.config,
      version: policy.version,
    });
  } catch (err) {
    console.error("[spendlens] GET /api/policies failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const auth = await requireSessionUser();
  if (isResponse(auth)) return auth;

  try {
    const { agentId } = await props.params;
    const body = await request.json();
    if (!body?.raw || typeof body.raw !== "string") {
      return NextResponse.json(
        { error: "Missing raw YAML string in request body" },
        { status: 400 },
      );
    }
    const saved = await upsertPolicy(auth.userId, agentId, body.raw);
    return NextResponse.json({
      success: true,
      agentId,
      raw: saved.raw,
      config: saved.config,
      version: saved.version,
    });
  } catch (err) {
    return NextResponse.json({ error: describePolicyError(err) }, { status: 400 });
  }
}
