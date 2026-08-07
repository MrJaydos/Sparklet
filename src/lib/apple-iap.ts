import { readFileSync } from "fs";
import { join } from "path";
import {
  SignedDataVerifier,
  Environment,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

const BUNDLE_ID = "com.sparklet.ios";

// The app's numeric App Store id — required by Apple's library only when
// verifying against Environment.PRODUCTION, and only exists once the app
// has a real App Store Connect record (it doesn't yet, see AGENTS.md in
// the sparklet-ios repo). Unset for now, same "quietly narrower without
// it" convention as STRIPE_SECRET_KEY — Production verification will
// legitimately fail until this is set, Sandbox/Xcode verification (what
// every purchase is today) doesn't need it.
const APP_APPLE_ID = process.env.APPLE_APP_STORE_ID
  ? Number(process.env.APPLE_APP_STORE_ID)
  : undefined;

// Apple Root CA - G3, downloaded from https://www.apple.com/certificateauthority/
// — the same public, non-secret root every App Store Server Library
// integration ships, required to verify the certificate chain embedded in
// each signed transaction actually terminates at Apple.
const rootCertificates = [readFileSync(join(process.cwd(), "certs/AppleRootCA-G3.cer"))];

// One verifier per environment, tried in order. A signed transaction embeds
// which environment it came from (Production / Sandbox / local Xcode
// testing) — the verifier throws on a mismatch rather than telling you
// which one to use, so this tries each rather than guessing. Real purchases
// submit Production; TestFlight/App Review submit Sandbox; the simulator's
// local StoreKit Testing config submits Xcode.
//
// Environment.XCODE is DEV-ONLY and must never be in this list on a
// deployed server. Apple's library skips signature verification entirely
// for it (jws_verification.js: "Data is not signed by the App Store, and
// verification should be skipped") because Xcode's local StoreKit config
// signs with a throwaway local cert, not Apple's chain. Everything that
// survives is `bundleId` and `environment` — both attacker-controlled
// fields *inside* the unsigned payload. With XCODE reachable in prod,
// anyone who can hit POST /api/billing/apple/verify can hand-roll a JWS
// with a garbage signature, a far-future expiresDate and
// `environment: "Xcode"`, and grant themselves permanent premium.
//
// Production is skipped entirely while APP_APPLE_ID is unset: the library's
// constructor throws immediately for Environment.PRODUCTION without one
// (there's no app in App Store Connect yet — see AGENTS.md in the
// sparklet-ios repo), which would otherwise crash module load, not just
// reject production receipts. Same "unset = feature quietly narrower"
// convention as STRIPE_SECRET_KEY/getStripe().
const environments = [
  ...(APP_APPLE_ID ? [Environment.PRODUCTION] : []),
  Environment.SANDBOX,
  ...(process.env.NODE_ENV === "production" ? [] : [Environment.XCODE]),
];
const verifiers = environments.map(
  (environment) => new SignedDataVerifier(rootCertificates, true, environment, BUNDLE_ID, APP_APPLE_ID)
);

async function tryVerifiers<T>(verify: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const verifier of verifiers) {
    try {
      return await verify(verifier);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export function verifyAppleTransaction(signedTransactionInfo: string): Promise<JWSTransactionDecodedPayload> {
  return tryVerifiers((v) => v.verifyAndDecodeTransaction(signedTransactionInfo));
}

export function verifyAppleNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
  return tryVerifiers((v) => v.verifyAndDecodeNotification(signedPayload));
}

/**
 * Absolute-upsert, same philosophy as the Stripe webhook's
 * upsertFromSubscription (src/app/api/billing/webhook/route.ts) — mirrors
 * whatever Apple says onto the row rather than incrementing/toggling,
 * since a signed transaction can be resubmitted or a notification
 * redelivered.
 *
 * One subscription, one account: User.appleOriginalTransactionId is
 * @unique, so a receipt already claimed by someone else can't be re-used to
 * light up a second account — first claim wins and the rest bounce off the
 * DB. That constraint is the actual enforcement; this returns "claimed"
 * rather than letting the raw P2002 surface as a 500, so the caller can say
 * something true to the user. A user re-submitting their *own* receipt
 * (restore purchases, Transaction.updates replay) is the normal path and
 * still just updates their row.
 */
export type ApplyResult = "ok" | "claimed";

export async function applyAppleTransaction(
  userId: string,
  transaction: JWSTransactionDecodedPayload
): Promise<ApplyResult> {
  if (!transaction.originalTransactionId) return "ok";
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        appleOriginalTransactionId: transaction.originalTransactionId,
        appleExpiresAt: transaction.expiresDate ? new Date(transaction.expiresDate) : null,
        appleRevoked: transaction.revocationDate != null,
      },
    });
    return "ok";
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" // unique violation on appleOriginalTransactionId
    ) {
      return "claimed";
    }
    throw err;
  }
}

/**
 * Same reconciliation, keyed by originalTransactionId instead of a known
 * userId — for the notifications webhook, which (like Stripe's webhook
 * keying off stripeCustomerId) only identifies the purchaser by an
 * Apple-side id. Relies on that id already being linked via
 * applyAppleTransaction at original-purchase time, same bootstrapping
 * order Stripe's checkout→webhook flow uses.
 */
export async function applyAppleTransactionByOriginalId(transaction: JWSTransactionDecodedPayload) {
  if (!transaction.originalTransactionId) return;
  await prisma.user.updateMany({
    where: { appleOriginalTransactionId: transaction.originalTransactionId },
    data: {
      appleExpiresAt: transaction.expiresDate ? new Date(transaction.expiresDate) : null,
      appleRevoked: transaction.revocationDate != null,
    },
  });
}
