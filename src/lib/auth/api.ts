import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { resolveApiKey, touchApiKey, type ResolvedApiKey } from "@/lib/db/api-keys";

/** Session-authenticated route handlers. Returns the user id or a 401 Response. */
export async function requireSessionUser(): Promise<
  { userId: string } | NextResponse
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!session.user.emailVerified) {
    return NextResponse.json({ error: "Email not verified" }, { status: 403 });
  }
  return { userId: session.user.id };
}

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

/** API-key-authenticated ingest. Reads `Authorization: Bearer sl_…` (or
 *  `x-api-key`), resolves the tenant + agent, and updates last-used. */
export async function requireApiKey(
  request: Request,
): Promise<ResolvedApiKey | NextResponse> {
  const header =
    request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : header.trim();

  const resolved = await resolveApiKey(token);
  if (!resolved) {
    return NextResponse.json(
      { error: "Invalid or revoked API key" },
      { status: 401 },
    );
  }
  // best-effort; never blocks ingest
  void touchApiKey(resolved.keyId).catch(() => {});
  return resolved;
}
