import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";
import { sendEmail } from "@/lib/email";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

type SocialProviders = NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>;

/** Only register a social provider when both its env vars are present, so the
 *  app runs fine with no OAuth configured (the buttons hide themselves). */
function socialProviders(): SocialProviders {
  const providers: SocialProviders = {};
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  return providers;
}

export const enabledSocialProviders = Object.keys(socialProviders()) as Array<
  "github" | "google"
>;

export const auth = betterAuth({
  appName: "Spendlens",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [appUrl],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Verification is disabled for now — users can sign in immediately after
    // signup. Flip this back to `true` (and `emailVerification.sendOnSignUp`)
    // once an e-mail provider is configured.
    requireEmailVerification: false,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your Spendlens password",
        heading: "Reset your password",
        body: "We received a request to reset your Spendlens password. This link expires in 1 hour. If you didn't ask for this, you can ignore this e-mail.",
        cta: { label: "Choose a new password", url },
      });
    },
  },
  emailVerification: {
    // No verification e-mail on signup while verification is not required.
    // The manual "resend" endpoint still works if you re-enable the flow.
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your Spendlens e-mail",
        heading: "Confirm your e-mail address",
        body: "Confirm this address to finish setting up your Spendlens account.",
        cta: { label: "Verify e-mail", url },
      });
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "google"],
    },
  },
  user: {
    deleteUser: { enabled: true },
  },
  socialProviders: socialProviders(),
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },
  // Must stay last: lets Server Actions / route handlers set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
