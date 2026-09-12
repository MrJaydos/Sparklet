import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRetryablePlayFailure,
  normalizeSubscription,
  PlayVerificationError,
  type SubscriptionV2Response,
} from "./google-play";
import { isPremiumViaGooglePlay } from "./billing";

// normalizeSubscription is the whole entitlement decision for the Play rail,
// and it is pure — no network, no service account, no DB — so the rules it
// encodes can be pinned directly.

const future = new Date(Date.now() + 86_400_000).toISOString();

function subscription(state: string, expiry = future): SubscriptionV2Response {
  return { subscriptionState: state, lineItems: [{ expiryTime: expiry }] };
}

/**
 * The regression this file exists for. SUBSCRIPTION_STATE_CANCELED does NOT
 * mean access has ended — it means auto-renew is off and the subscription has
 * not expired yet. Treating it as revoked took premium away the moment someone
 * cancelled, in the middle of a period they had already paid for.
 */
test("google play: cancelling auto-renew keeps access until expiry", () => {
  const purchase = normalizeSubscription("token", subscription("SUBSCRIPTION_STATE_CANCELED"));
  assert.equal(purchase.revoked, false);
  assert.equal(
    isPremiumViaGooglePlay({
      googleExpiresAt: purchase.expiresAt,
      googleRevoked: purchase.revoked,
    }),
    true
  );
});

test("google play: a subscription in its grace period still entitles", () => {
  assert.equal(
    normalizeSubscription("token", subscription("SUBSCRIPTION_STATE_IN_GRACE_PERIOD")).revoked,
    false
  );
});

test("google play: active entitles", () => {
  assert.equal(
    normalizeSubscription("token", subscription("SUBSCRIPTION_STATE_ACTIVE")).revoked,
    false
  );
});

// On hold and paused mean the user currently has no access; pending means they
// haven't finished paying for it yet.
test("google play: on-hold, paused and pending do not entitle", () => {
  for (const state of [
    "SUBSCRIPTION_STATE_ON_HOLD",
    "SUBSCRIPTION_STATE_PAUSED",
    "SUBSCRIPTION_STATE_PENDING",
    "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
  ]) {
    assert.equal(normalizeSubscription("token", subscription(state)).revoked, true, state);
  }
});

// Expiry alone covers this one, the same way it does on the Apple rail — which
// is why EXPIRED isn't in the revoked set.
test("google play: an expired subscription is handled by its expiry, not a flag", () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const purchase = normalizeSubscription("token", subscription("SUBSCRIPTION_STATE_EXPIRED", past));
  assert.equal(purchase.revoked, false);
  assert.equal(
    isPremiumViaGooglePlay({
      googleExpiresAt: purchase.expiresAt,
      googleRevoked: purchase.revoked,
    }),
    false
  );
});

test("google play: the furthest line-item expiry governs access", () => {
  const soon = new Date(Date.now() + 3_600_000);
  const later = new Date(Date.now() + 7_200_000);
  const purchase = normalizeSubscription("token", {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    lineItems: [{ expiryTime: soon.toISOString() }, { expiryTime: later.toISOString() }],
  });
  assert.equal(purchase.expiresAt?.getTime(), later.getTime());
});

test("google play: no usable expiry means no entitlement", () => {
  const purchase = normalizeSubscription("token", { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" });
  assert.equal(purchase.expiresAt, null);
  assert.equal(
    isPremiumViaGooglePlay({ googleExpiresAt: purchase.expiresAt, googleRevoked: false }),
    false
  );
});

test("google play: the superseded token is carried through for release", () => {
  const purchase = normalizeSubscription("new-token", {
    ...subscription("SUBSCRIPTION_STATE_ACTIVE"),
    linkedPurchaseToken: "old-token",
  });
  assert.equal(purchase.linkedPurchaseToken, "old-token");
});

// The allowlist is opt-in: unset, any subscription under the package entitles,
// which is right while premium is the only product on sale.
test("google play: the product allowlist only applies once it is set", () => {
  const before = process.env.GOOGLE_PLAY_PRODUCT_IDS;
  try {
    delete process.env.GOOGLE_PLAY_PRODUCT_IDS;
    assert.equal(
      normalizeSubscription("token", {
        ...subscription("SUBSCRIPTION_STATE_ACTIVE"),
        lineItems: [{ expiryTime: future, productId: "something.else" }],
      }).revoked,
      false
    );

    process.env.GOOGLE_PLAY_PRODUCT_IDS = "premium.monthly, premium.annual";
    assert.doesNotThrow(() =>
      normalizeSubscription("token", {
        subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
        lineItems: [{ expiryTime: future, productId: "premium.annual" }],
      })
    );
    // A real purchase of a product that isn't premium: permanent, so callers
    // answer 400 rather than retrying it forever.
    assert.throws(
      () =>
        normalizeSubscription("token", {
          subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
          lineItems: [{ expiryTime: future, productId: "something.else" }],
        }),
      (err: unknown) => err instanceof PlayVerificationError && err.retryable === false
    );
  } finally {
    if (before === undefined) delete process.env.GOOGLE_PLAY_PRODUCT_IDS;
    else process.env.GOOGLE_PLAY_PRODUCT_IDS = before;
  }
});

// What decides whether an RTDN is acknowledged or handed back to Pub/Sub.
test("play failures: unknown errors are assumed transient, verdicts are not", () => {
  assert.equal(isRetryablePlayFailure(new Error("socket hang up")), true);
  assert.equal(isRetryablePlayFailure(new PlayVerificationError("api returned 503", true)), true);
  assert.equal(isRetryablePlayFailure(new PlayVerificationError("api returned 410", false)), false);
});
