import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic auth routing (Next 16's renamed middleware). Only reads the
 * session cookie — never the DB — so it stays fast on every request. The real
 * enforcement is in the DAL (`requireUser` / `requireVerifiedUser`), close to
 * the data.
 */

const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (pathname.startsWith("/dashboard") && !hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && AUTH_PAGES.some((p) => pathname === p)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the auth API, and static assets.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|jpeg|webp)$).*)"],
};
