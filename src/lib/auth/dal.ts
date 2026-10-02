import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, emailVerificationRequired } from "@/lib/auth";

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

/**
 * Sends a visitor who is already signed in away from /login, /signup, … to the
 * dashboard. This checks the real session, not just the cookie: the proxy can
 * only see that a session cookie EXISTS, and bouncing on that alone sent
 * anyone holding a stale one (session revoked, database restored, account
 * deleted elsewhere) round /login → /dashboard → /login … until the browser
 * gave up with "too many redirects" — with no way out short of clearing
 * cookies by hand.
 */
export async function redirectIfSignedIn(): Promise<void> {
  const session = await getOptionalUser();
  if (session?.user) redirect("/dashboard");
}

/** The gate every dashboard surface uses: signed in, and — whenever
 *  verification is required (see `emailVerificationRequired`) — with a
 *  verified e-mail address. */
export async function requireVerifiedUser() {
  const session = await requireUser();
  if (emailVerificationRequired && !session.user.emailVerified) {
    redirect(`/verify-email`);
  }
  return session;
}
