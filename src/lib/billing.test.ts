import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPremium,
  isPremiumViaAppStore,
  isPremiumViaGooglePlay,
  premiumSource,
} from "./billing";

// Entitlement is derived at read time on all three rails, so these are pure
// functions over a row — no DB, no network, no test framework needed beyond
// what Node ships with.

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

const none = {
  stripeSubscriptionStatus: null,
  stripeCurrentPeriodEnd: null,
  appleExpiresAt: null,
  appleRevoked: false,
  googleExpiresAt: null,
  googleRevoked: false,
};

test("google play: a live subscription is premium", () => {
  assert.equal(isPremiumViaGooglePlay({ googleExpiresAt: future(), googleRevoked: false }), true);
});

// The whole point of deriving rather than storing: a missed cancellation
// notification expires access at period end instead of granting it forever.
test("google play: an expired subscription is not premium", () => {
  assert.equal(isPremiumViaGooglePlay({ googleExpiresAt: past(), googleRevoked: false }), false);
});

// A refund/chargeback revokes immediately, without waiting for expiry.
test("google play: a revoked subscription is not premium even before expiry", () => {
  assert.equal(isPremiumViaGooglePlay({ googleExpiresAt: future(), googleRevoked: true }), false);
});

test("google play: never subscribed is not premium", () => {
  assert.equal(isPremiumViaGooglePlay({ googleExpiresAt: null, googleRevoked: false }), false);
});

test("isPremium is true if any single rail entitles", () => {
  assert.equal(isPremium({ ...none, googleExpiresAt: future() }), true);
  assert.equal(isPremium({ ...none, appleExpiresAt: future() }), true);
  assert.equal(isPremium(none), false);
});

// Adding the Google rail must not have changed what Apple alone reports.
test("adding the google rail left the apple rail untouched", () => {
  assert.equal(isPremiumViaAppStore({ appleExpiresAt: future(), appleRevoked: false }), true);
  assert.equal(isPremiumViaAppStore({ appleExpiresAt: future(), appleRevoked: true }), false);
});

// Store rails win over Stripe: Stripe's customer portal can't cancel them, and
// pointing someone at the wrong place to cancel is worse than being right
// about the other one.
test("premiumSource prefers store rails over stripe", () => {
  const stripeLive = {
    ...none,
    stripeSubscriptionStatus: "active",
    stripeCurrentPeriodEnd: future(),
  };
  assert.equal(premiumSource({ ...stripeLive, googleExpiresAt: future() }), "play_store");
  assert.equal(premiumSource({ ...stripeLive, appleExpiresAt: future() }), "app_store");
  assert.equal(premiumSource(none), null);
});

test("premiumSource prefers app_store when both store rails are live", () => {
  assert.equal(
    premiumSource({ ...none, appleExpiresAt: future(), googleExpiresAt: future() }),
    "app_store"
  );
});
