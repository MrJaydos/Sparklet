import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPremium } from "@/lib/billing";
import {
  applyGooglePurchase,
  isGooglePlayBillingEnabled,
  isRetryablePlayFailure,
  verifyGooglePurchase,
} from "@/lib/google-play";

const bodySchema = z.object({ purchaseToken: z.string().min(1) });

// The primary reconciliation path for native Android purchases, mirroring
// POST /api/billing/apple/verify: the client hands over the purchase token it
// got from Play Billing after a purchase or a restore, we ask Google what
// that token actually entitles, and mirror the answer onto the authenticated
// user's row. See POST /api/billing/google/notifications for the server-push
// equivalent covering renewals and refunds while the app isn't open.
//
// The client sends nothing but the opaque token — no expiry, no product, no
// "premium: true". Everything that decides entitlement comes back from
// Google, so a forged or replayed token grants nothing.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Distinct from a verification failure: the server has no Play credentials
  // at all, so this is a deployment gap rather than anything the client did
  // or could fix by retrying with a different token.
  if (!isGooglePlayBillingEnabled()) {
    return NextResponse.json({ error: "google play billing is not configured" }, { status: 503 });
  }

  let purchase;
  try {
    purchase = await verifyGooglePurchase(parsed.data.purchaseToken);
  } catch (err) {
    // Google being unreachable is not a verdict on the token, and not the
    // client's fault: 503 tells the app to try again on the next launch or
    // restore. A 400 here reads as "your purchase is invalid" and would send
    // someone with a perfectly good subscription to support instead.
    return isRetryablePlayFailure(err)
      ? NextResponse.json({ error: "could not reach Google to verify; try again" }, { status: 503 })
      : NextResponse.json({ error: "could not verify purchase" }, { status: 400 });
  }

  // Already linked to a different account — one Play subscription unlocks one
  // Sparklet account (see applyGooglePurchase). Answering 409 rather than
  // letting the unique violation escape as a 500 is the difference between
  // "that purchase isn't yours" and "our server is broken".
  if ((await applyGooglePurchase(userId, purchase)) === "claimed") {
    return NextResponse.json(
      { error: "That purchase is already linked to another Sparklet account." },
      { status: 409 }
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      stripeSubscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
      appleExpiresAt: true,
      appleRevoked: true,
      googleExpiresAt: true,
      googleRevoked: true,
    },
  });

  return NextResponse.json({
    premium: isPremium(user),
    expiresAt: user.googleExpiresAt?.toISOString() ?? null,
  });
}
