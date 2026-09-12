"use client";
import { createAuthClient } from "better-auth/react";

// No explicit baseURL: `NEXT_PUBLIC_*` vars are inlined into the client
// bundle at `next build` time, not read at container runtime — the
// Dockerfile builds with a `localhost:3000` placeholder (real secrets and
// the DB aren't available in the build stage), so a baked-in baseURL here
// would silently point every deployed instance's sign-in/sign-up calls at
// `localhost:3000` instead of its real public URL. Better Auth's client
// falls back to a same-origin relative path ("/api/auth") when baseURL is
// omitted, which is correct for this app in every environment — dashboard
// and API always share one origin, so there's nothing an absolute URL adds.
export const authClient = createAuthClient({});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
