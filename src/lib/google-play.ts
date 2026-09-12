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

// Optional allowlist of subscription product ids that grant premium, as a
// comma-separated env var. Unset keeps today's behaviour — any subscription
// under PACKAGE_NAME entitles — which is correct while premium is the only
// product Play Console sells. Set it the moment a second subscription product
// exists, or buying the cheaper one would unlock everything. Checked against
// the product ids Google returns, never anything the client sent.
function allowedProductIds(): string[] {
  return (process.env.GOOGLE_PLAY_PRODUCT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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

/**
 * A verification that didn't produce an answer, carrying whether asking again
 * later could plausibly produce one. That single bit is what separates
 * acknowledging a Real-Time Developer Notification from asking Pub/Sub to
 * redeliver it, and a "try again" from a "that token is not a purchase" in the
 * client-driven route.
 */
export class PlayVerificationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "PlayVerificationError";
  }
}

/**
 * Whether a failed verification is worth retrying. Anything that isn't a
 * PlayVerificationError — a DNS failure, a socket reset, the auth library
 * failing to mint a token — is transient by assumption: treating an unknown
 * failure as permanent is how a refund gets silently dropped.
 */
export function isRetryablePlayFailure(err: unknown): boolean {
  return err instanceof PlayVerificationError ? err.retryable : true;
}

// 5xx/408/429 are transient by definition. 401/403 mean the service account's
// credentials or Play API access are wrong — a deployment gap someone can fix,
// so a redelivery afterwards should still land rather than having been dropped
// while the endpoint was misconfigured. Everything else (400 malformed, 404
// unknown token, 410 aged out) fails identically however often it is resent.
function statusIsRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429 || status === 401 || status === 403;
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

export type SubscriptionV2Response = {
  subscriptionState?: string;
  linkedPurchaseToken?: string;
  lineItems?: Array<{ expiryTime?: string; productId?: string }>;
};

// States that mean "this subscription is not currently entitling anyone".
//
// EXPIRED is deliberately absent: an expired subscription is handled by the
// expiry timestamp alone, exactly as Apple's is, so a clock comparison
// remains the single source of truth for the common case.
//
// CANCELED is deliberately absent too, and that one is load-bearing. In the
// Play API it does NOT mean "access has ended" — it means auto-renew is off
// and the subscription has not expired yet, so the user keeps the period they
// have already paid for, until expiryTime. Listing it here cut premium off the
// instant someone cancelled, which also contradicted the Apple rail, where
// appleRevoked comes from revocationDate (refund/chargeback) and never from a
// cancellation. IN_GRACE_PERIOD is absent for the same reason: still entitled.
//
// PENDING is present because the opposite holds there — the purchase exists
// but payment hasn't completed, so nothing has been bought yet.
const REVOKED_STATES = new Set([
  "SUBSCRIPTION_STATE_PENDING",
  "SUBSCRIPTION_STATE_ON_HOLD",
  "SUBSCRIPTION_STATE_PAUSED",
  "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
]);

/**
 * Google's answer about a subscription → what this app stores.
 *
 * Split out from the fetch so the entitlement rules — which states revoke,
 * which expiry governs, which products count — are testable without a network
 * or a service account. src/lib/google-play.test.ts pins them.
 */
export function normalizeSubscription(
  purchaseToken: string,
  body: SubscriptionV2Response
): GooglePurchase {
  const allowed = allowedProductIds();
  if (allowed.length > 0) {
    const products = (body.lineItems ?? [])
      .map((item) => item.productId)
      .filter((value): value is string => typeof value === "string");
    if (!products.some((product) => allowed.includes(product))) {
      // A real purchase of something that isn't premium. Permanent: the same
      // token will describe the same product forever.
      throw new PlayVerificationError("purchase is not for a premium product", false);
    }
  }

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
 * Verifies a purchase token against Google and normalises the result.
 * Throws if billing isn't configured or Google rejects the token — callers
 * map that to a 4xx/503 rather than trusting anything the client said, using
 * isRetryablePlayFailure() to decide which.
 *
 * Note what is NOT trusted here: the client sends only the opaque purchase
 * token. Expiry, entitlement and revocation all come back from Google, so a
 * forged or replayed token can't grant anything — the Android equivalent of
 * why apple-iap.ts verifies the JWS signature rather than reading its
 * payload.
 */
export async function verifyGooglePurchase(purchaseToken: string): Promise<GooglePurchase> {
  const googleAuth = getAuth();
  // Retryable: no credentials is a deployment gap that may be fixed by the
  // time a notification is redelivered.
  if (!googleAuth) throw new PlayVerificationError("google play billing not configured", true);

  const client = await googleAuth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new PlayVerificationError("could not obtain a Play Developer API access token", true);
  }

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/` +
    `${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    // Includes 404 for a token that never existed and 410 for one Google has
    // aged out — both mean "don't grant anything", which is what throwing
    // achieves here. Neither is worth retrying; a 5xx or a credential problem
    // is (see statusIsRetryable).
    throw new PlayVerificationError(
      `play developer api returned ${response.status}`,
      statusIsRetryable(response.status)
    );
  }

  const body = (await response.json()) as SubscriptionV2Response;
  return normalizeSubscription(purchaseToken, body);
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
  try {
    // One transaction so a failed claim doesn't leave the superseded token
    // released. Resubscribing issues a fresh token that supersedes the old
    // one, and releasing the old one keeps a dangling unique claim from
    // outliving the subscription it described — but if the new token turns out
    // to belong to another account, that release has to roll back with the
    // rest, or this would strip a token off a row while telling the caller
    // nothing changed. The superseded row keeps its expiry: it is time
    // somebody paid for, and it lapses on its own (the same reason nothing
    // here is stored as a boolean).
    await prisma.$transaction(async (tx) => {
      if (purchase.linkedPurchaseToken) {
        await tx.user.updateMany({
          where: { googlePurchaseToken: purchase.linkedPurchaseToken },
          data: { googlePurchaseToken: null },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          googlePurchaseToken: purchase.purchaseToken,
          googleExpiresAt: purchase.expiresAt,
          googleRevoked: purchase.revoked,
        },
      });
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
