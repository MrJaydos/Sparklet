import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; premium: boolean; premiumSource: "app_store" | "stripe" | null } &
      DefaultSession["user"];
  }
}

// The Prisma adapter's `user` param in callbacks is the full DB row at
// runtime, but its TS type is the narrower built-in AdapterUser — extend it
// so isPremium()/premiumSource() (which read these columns) type-check in
// src/auth.ts.
declare module "@auth/core/adapters" {
  interface AdapterUser {
    stripeSubscriptionStatus: string | null;
    stripeCurrentPeriodEnd: Date | null;
    appleExpiresAt: Date | null;
    appleRevoked: boolean;
  }
}
