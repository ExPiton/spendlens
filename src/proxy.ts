import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic auth routing (Next 16's renamed middleware). Only reads the
 * session cookie — never the DB — so it stays fast on every request. The real
 * enforcement is in the DAL (`requireUser` / `requireVerifiedUser`), close to
 * the data.
 *
 * It only ever sends a cookie-less visitor TO /login. The opposite hop
 * (signed-in visitor on /login → /dashboard) must not be decided from the
 * cookie alone — a stale cookie then loops /login ⇄ /dashboard forever — so
 * the auth pages do it themselves, against the real session
 * (`redirectIfSignedIn`).
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (pathname.startsWith("/dashboard") && !hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the auth API, and static assets.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|jpeg|webp)$).*)"],
};
