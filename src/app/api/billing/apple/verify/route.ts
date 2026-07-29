import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPremium } from "@/lib/billing";
import { verifyAppleTransaction, applyAppleTransaction } from "@/lib/apple-iap";

const bodySchema = z.object({ signedTransactionInfo: z.string().min(1) });

// The primary reconciliation path for native iOS purchases: the client
// hands over the signed transaction it got straight from StoreKit
// (Transaction.jwsRepresentation) after a purchase, a restore, or a
// Transaction.updates event, we verify it's actually from Apple and
// actually for this app, and mirror it onto the authenticated user's row.
// See POST /api/billing/apple/notifications for the server-push
// equivalent (renewals/refunds while the app isn't open) — this route
// covers everything else and needs nothing from App Store Connect to work.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  let transaction;
  try {
    transaction = await verifyAppleTransaction(parsed.data.signedTransactionInfo);
  } catch {
    return NextResponse.json({ error: "could not verify transaction" }, { status: 400 });
  }

  await applyAppleTransaction(userId, transaction);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      stripeSubscriptionStatus: true,
      stripeCurrentPeriodEnd: true,
      appleExpiresAt: true,
      appleRevoked: true,
    },
  });

  return NextResponse.json({
    premium: isPremium(user),
    expiresAt: user.appleExpiresAt?.toISOString() ?? null,
  });
}
