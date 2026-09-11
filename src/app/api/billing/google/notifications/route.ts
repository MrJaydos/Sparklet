import { NextRequest, NextResponse } from "next/server";
import {
  applyGooglePurchaseByToken,
  isGooglePlayBillingEnabled,
  verifyGooglePurchase,
} from "@/lib/google-play";

/**
 * Google Play Real-Time Developer Notifications — the server-push equivalent
 * of POST /api/billing/google/verify, for renewals, cancellations, refunds
 * and expirations that happen while the app isn't open. Mirrors the roles of
 * src/app/api/billing/apple/notifications/route.ts and the Stripe webhook.
 *
 * RTDN arrives as a Pub/Sub push: the developer notification is base64 inside
 * `message.data`.
 *
 * SECURITY: unlike Apple's notifications (a JWS signed by Apple) and Stripe's
 * (a signed header), a Pub/Sub push carries no signature this code verifies,
 * so treat the body as an untrusted hint that *something* changed. Nothing
 * here is applied from the payload — the purchase token is re-verified
 * against Google and only Google's answer is written. A forged notification
 * can therefore do no more than make the server re-fetch state it already
 * had. Hardening this further (an OIDC token on the push subscription, or a
 * shared secret in the URL) is worth doing when the Pub/Sub subscription is
 * actually created, but it is defence in depth rather than what makes this
 * safe.
 *
 * Inert until a Pub/Sub topic is registered in Play Console, which needs an
 * app record there first — the code doesn't depend on that, only real traffic
 * does.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const data = body?.message?.data;
  if (typeof data !== "string") {
    // Malformed, or not a Pub/Sub push at all. 400 rather than a retry: this
    // will never parse, however many times Google resends it.
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  let notification: {
    subscriptionNotification?: { purchaseToken?: string };
    voidedPurchaseNotification?: { purchaseToken?: string };
    testNotification?: unknown;
  };
  try {
    notification = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  // Play Console sends one of these when you first register the topic, purely
  // to prove the endpoint is reachable. Acknowledge it and do nothing.
  if (notification.testNotification) {
    return NextResponse.json({ received: true });
  }

  const purchaseToken =
    notification.subscriptionNotification?.purchaseToken ??
    notification.voidedPurchaseNotification?.purchaseToken;

  // Nothing actionable (a one-time product notification, say). Acknowledge so
  // Pub/Sub stops redelivering it.
  if (!purchaseToken) return NextResponse.json({ received: true });

  if (!isGooglePlayBillingEnabled()) {
    // Can't reconcile without credentials, but this one IS worth retrying —
    // it's a deployment gap that may be fixed by the time Pub/Sub redelivers,
    // and dropping it would silently lose a refund or cancellation.
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  try {
    const purchase = await verifyGooglePurchase(purchaseToken);
    await applyGooglePurchaseByToken(purchase);
  } catch {
    // Deliberately diverges from the Apple notifications route, which
    // acknowledges everything. There the payload is self-contained and signed,
    // so a failure to verify it will fail identically on redelivery. Here the
    // work is an outbound call to Google plus a DB write, and both fail
    // transiently — a 5xx asks Pub/Sub to redeliver, which is exactly what
    // should happen when a refund couldn't be recorded because the API
    // blipped. Pub/Sub gives up on its own after the subscription's retention
    // window, so this cannot retry forever.
    return NextResponse.json({ error: "could not reconcile" }, { status: 503 });
  }

  return NextResponse.json({ received: true });
}
