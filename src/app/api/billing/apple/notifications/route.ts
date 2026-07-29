import { NextRequest, NextResponse } from "next/server";
import { verifyAppleNotification, verifyAppleTransaction, applyAppleTransactionByOriginalId } from "@/lib/apple-iap";

/**
 * App Store Server Notifications V2 — the server-push equivalent of
 * POST /api/billing/apple/verify, for renewals/refunds/expirations that
 * happen while the app isn't open (mirrors src/app/api/billing/webhook/
 * route.ts's role for Stripe). Keyed by originalTransactionId rather than a
 * known userId, same asymmetry as Stripe's webhook keying off
 * stripeCustomerId — relies on that id already being linked via a prior
 * client-driven verify call.
 *
 * Inert until this URL is registered in App Store Connect, which needs the
 * app record to exist there first (see AGENTS.md in the sparklet-ios repo)
 * — the code itself doesn't depend on that, only real traffic does.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const signedPayload = body?.signedPayload;
  if (typeof signedPayload !== "string") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  let notification;
  try {
    notification = await verifyAppleNotification(signedPayload);
  } catch {
    return NextResponse.json({ error: "could not verify notification" }, { status: 400 });
  }

  const signedTransactionInfo = notification.data?.signedTransactionInfo;
  if (signedTransactionInfo) {
    try {
      // Already verified as part of a payload Apple just signed, but the
      // transaction itself is independently signed too — decode it the
      // same way the client-driven path does rather than trusting the
      // outer envelope's claims about it.
      const transaction = await verifyAppleTransaction(signedTransactionInfo);
      await applyAppleTransactionByOriginalId(transaction);
    } catch {
      // Still acknowledge receipt (200) below — Apple retries a non-2xx
      // response, and a transaction that fails to verify/apply now won't
      // succeed on a retry either. Same "don't retry the unfixable"
      // reasoning as the outer notification check above.
    }
  }

  return NextResponse.json({ received: true });
}
