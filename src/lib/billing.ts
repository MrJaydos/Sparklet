import Stripe from "stripe";

// Lazy client, absent key = billing quietly disabled (same convention as
// getBatchClient in ai-provider.ts, web push, and the Giphy fallback).
let client: Stripe | null | undefined;
export function getStripe(): Stripe | null {
  if (client !== undefined) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  client = key ? new Stripe(key) : null;
  return client;
}

// Whether the owner has set up Stripe at all — distinct from isPremium(),
// which answers "is this specific user a paying subscriber". Gates like the
// depth route must check THIS before enforcing anything: without it, every
// user's isPremium() is false, and gating on that alone would suddenly lock
// DEEP/EXTRA_DEEP for everyone the moment this code deploys, before there's
// even a working checkout to unlock it again. Same idea for the Upgrade CTAs
// — no point showing them (or a lock icon) for a subscription that can't be
// bought yet.
export function isBillingEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export const STRIPE_PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_ID_MONTHLY,
  annual: process.env.STRIPE_PRICE_ID_ANNUAL,
} as const;

type StripeBillingUser = {
  stripeSubscriptionStatus: string | null;
  stripeCurrentPeriodEnd: Date | null;
};
type AppleBillingUser = {
  appleExpiresAt: Date | null;
  appleRevoked: boolean;
};
type BillingUser = StripeBillingUser & AppleBillingUser;

// Derived, not stored: a missed cancellation webhook expires access safely
// at period end rather than granting it forever. No trial-length or
// past_due grace period for v1 — only a currently-paid-for period counts.
export function isPremiumViaStripe(user: StripeBillingUser): boolean {
  return (
    !!process.env.STRIPE_SECRET_KEY &&
    (user.stripeSubscriptionStatus === "active" || user.stripeSubscriptionStatus === "trialing") &&
    !!user.stripeCurrentPeriodEnd &&
    user.stripeCurrentPeriodEnd.getTime() > Date.now()
  );
}

// Apple has no separate "trialing" status the way Stripe does — a trial
// period just carries a normal expiresDate, so this check alone covers it.
export function isPremiumViaAppStore(user: AppleBillingUser): boolean {
  return !user.appleRevoked && !!user.appleExpiresAt && user.appleExpiresAt.getTime() > Date.now();
}

// Derived, not stored: a missed cancellation webhook (or Apple server
// notification) expires access safely at period end rather than granting it
// forever, on either rail.
export function isPremium(user: BillingUser): boolean {
  return isPremiumViaStripe(user) || isPremiumViaAppStore(user);
}

// Which platform the user's active subscription (if any) is on — for
// deciding what "manage subscription" should point at. A user can in theory
// have a live subscription on both — prefer app_store, since that's the one
// Stripe's customer portal can't touch, and telling them the wrong place to
// cancel is worse than being right about the other one.
export function premiumSource(user: BillingUser): "app_store" | "stripe" | null {
  if (isPremiumViaAppStore(user)) return "app_store";
  if (isPremiumViaStripe(user)) return "stripe";
  return null;
}
