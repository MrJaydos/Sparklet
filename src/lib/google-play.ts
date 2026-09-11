import { GoogleAuth } from "google-auth-library";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Google Play Billing, the Android counterpart to src/lib/apple-iap.ts.
// Deliberately the same shape: verify what the store says, then absolute-
// upsert it onto the user's row, with premium derived at read time in
// src/lib/billing.ts rather than stored as a boolean.
//
// Uses google-auth-library (service-account auth only) plus plain fetch
// against the Play Developer REST API, rather than the `googleapis`
// metapackage — that pulls every Google API's generated client for the one
// endpoint used here. Auth itself is the official library rather than a
// hand-rolled JWT, since this is the credential path for a payments route.

const PACKAGE_NAME = "com.sparklet.android";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

// Service-account JSON, as a single-line env var. Absent = Google billing
// quietly disabled, the same "unset means this feature is narrower, not
// broken" convention as STRIPE_SECRET_KEY/getStripe() and APPLE_APP_STORE_ID.
// Nothing else in the app needs to branch on it: with no credentials, verify
// returns 503 and no user ever gets googleExpiresAt set, so
// isPremiumViaGooglePlay() is false for everyone.
function serviceAccount(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    // A malformed credential is a deployment mistake, not a user error —
    // treat it as "not configured" rather than throwing on module load and
    // taking the whole app down.
    return null;
  }
}

export function isGooglePlayBillingEnabled(): boolean {
  return serviceAccount() !== null;
}

let auth: GoogleAuth | null | undefined;
function getAuth(): GoogleAuth | null {
  if (auth !== undefined) return auth;
  const credentials = serviceAccount();
  // Lazy, mirroring getStripe(): constructing this at module scope would
  // make the credential's presence a load-time concern for every route that
  // transitively imports billing.
  auth = credentials ? new GoogleAuth({ credentials, scopes: [SCOPE] }) : null;
  return auth;
}

// What the two callers actually need out of a subscription, normalised away
// from the API's own shape so the route and the notification handler don't
// both have to know it.
export type GooglePurchase = {
  purchaseToken: string;
  expiresAt: Date | null;
  revoked: boolean;
  // Present when Google replaced an earlier token (resubscribe/upgrade); the
  // old row must be cleared or it keeps its unique claim on the token.
  linkedPurchaseToken: string | null;
};

type SubscriptionV2Response = {
  subscriptionState?: string;
  linkedPurchaseToken?: string;
  lineItems?: Array<{ expiryTime?: string }>;
};

// States that mean "this subscription is not currently entitling anyone".
// EXPIRED is deliberately absent: an expired subscription is handled by the
// expiry timestamp alone, exactly as Apple's is, so a clock comparison
// remains the single source of truth for the common case.
const REVOKED_STATES = new Set([
  "SUBSCRIPTION_STATE_CANCELED",
  "SUBSCRIPTION_STATE_ON_HOLD",
  "SUBSCRIPTION_STATE_PAUSED",
  "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
]);

/**
 * Verifies a purchase token against Google and normalises the result.
 * Throws if billing isn't configured or Google rejects the token — callers
 * map that to a 4xx/503 rather than trusting anything the client said.
 *
 * Note what is NOT trusted here: the client sends only the opaque purchase
 * token. Expiry, entitlement and revocation all come back from Google, so a
 * forged or replayed token can't grant anything — the Android equivalent of
 * why apple-iap.ts verifies the JWS signature rather than reading its
 * payload.
 */
export async function verifyGooglePurchase(purchaseToken: string): Promise<GooglePurchase> {
  const googleAuth = getAuth();
  if (!googleAuth) throw new Error("google play billing not configured");

  const client = await googleAuth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("could not obtain a Play Developer API access token");

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/` +
    `${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    // Includes 404 for a token that never existed and 410 for one Google has
    // aged out — both mean "don't grant anything", which is what throwing
    // achieves here.
    throw new Error(`play developer api returned ${response.status}`);
  }

  const body = (await response.json()) as SubscriptionV2Response;

  // A subscription can have several line items (a plan change mid-cycle);
  // the furthest expiry is the one that actually governs access.
  const expiryTimes = (body.lineItems ?? [])
    .map((item) => item.expiryTime)
    .filter((value): value is string => typeof value === "string")
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  const expiresAt = expiryTimes.length
    ? new Date(Math.max(...expiryTimes.map((date) => date.getTime())))
    : null;

  return {
    purchaseToken,
    expiresAt,
    revoked: REVOKED_STATES.has(body.subscriptionState ?? ""),
    linkedPurchaseToken: body.linkedPurchaseToken ?? null,
  };
}

/**
 * Absolute-upsert onto a known user, mirroring applyAppleTransaction: writes
 * whatever Google says rather than incrementing or toggling, since a token
 * can be resubmitted on every app launch and a notification redelivered.
 *
 * One subscription, one account: User.googlePurchaseToken is @unique, so a
 * token already claimed elsewhere bounces off the DB rather than lighting up
 * a second account. That constraint is the enforcement; returning "claimed"
 * just lets the caller say something true instead of leaking a P2002 as a
 * 500. A user re-submitting their own token is the normal path and simply
 * updates their row.
 */
export type ApplyResult = "ok" | "claimed";

export async function applyGooglePurchase(
  userId: string,
  purchase: GooglePurchase
): Promise<ApplyResult> {
  // Resubscribing issues a fresh token that supersedes the old one. Release
  // the superseded token first, or its unique claim blocks the new row and
  // this returns "claimed" against the user's own previous subscription.
  if (purchase.linkedPurchaseToken) {
    await prisma.user.updateMany({
      where: { googlePurchaseToken: purchase.linkedPurchaseToken },
      data: { googlePurchaseToken: null },
    });
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        googlePurchaseToken: purchase.purchaseToken,
        googleExpiresAt: purchase.expiresAt,
        googleRevoked: purchase.revoked,
      },
    });
    return "ok";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "claimed";
    }
    throw err;
  }
}

/**
 * Same reconciliation keyed by the token instead of a known userId — for
 * Real-Time Developer Notifications, which (like Stripe's webhook keying off
 * stripeCustomerId, and Apple's off originalTransactionId) only identify the
 * purchaser by a store-side id. Relies on the token already being linked by
 * a prior client-driven verify, the same bootstrapping order the other two
 * rails use.
 */
export async function applyGooglePurchaseByToken(purchase: GooglePurchase): Promise<void> {
  await prisma.user.updateMany({
    where: { googlePurchaseToken: purchase.purchaseToken },
    data: {
      googleExpiresAt: purchase.expiresAt,
      googleRevoked: purchase.revoked,
    },
  });
}
