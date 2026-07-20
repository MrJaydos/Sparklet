import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getStripe, STRIPE_PRICE_IDS } from "@/lib/billing";

const bodySchema = z.object({ plan: z.enum(["monthly", "annual"]) });

const APP_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "billing unavailable" }, { status: 503 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const priceId = STRIPE_PRICE_IDS[parsed.data.plan];
  if (!priceId) return NextResponse.json({ error: "billing unavailable" }, { status: 503 });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, stripeCustomerId: true },
  });

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.id,
    metadata: { userId: user.id },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${APP_URL}/upgrade?status=success`,
    cancel_url: `${APP_URL}/upgrade?status=cancel`,
  });

  if (!checkoutSession.url) {
    return NextResponse.json({ error: "checkout session creation failed" }, { status: 502 });
  }
  return NextResponse.json({ url: checkoutSession.url });
}
