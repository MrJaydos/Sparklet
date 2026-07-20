import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; premium: boolean } & DefaultSession["user"];
  }
}

// The Prisma adapter's `user` param in callbacks is the full DB row at
// runtime, but its TS type is the narrower built-in AdapterUser — extend it
// so isPremium() (which reads these two columns) type-checks in src/auth.ts.
declare module "@auth/core/adapters" {
  interface AdapterUser {
    stripeSubscriptionStatus: string | null;
    stripeCurrentPeriodEnd: Date | null;
  }
}
