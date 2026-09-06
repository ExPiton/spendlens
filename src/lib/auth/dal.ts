import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Data Access Layer for auth. Every server component / route handler / action
 * that touches user data goes through one of these. `cache()` dedupes the
 * session lookup within a single render pass.
 */

export const getOptionalUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ?? null;
});

/** Redirects to /login when signed out. Use in every protected surface. */
export async function requireUser() {
  const session = await getOptionalUser();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/** The gate every dashboard surface uses. Currently identical to
 *  `requireUser()` — e-mail verification is not enforced. Kept as a distinct
 *  name so re-enabling verification is a one-place change: restore the
 *  `emailVerified` check here (and the two auth-config flags). */
export async function requireVerifiedUser() {
  return requireUser();
}
