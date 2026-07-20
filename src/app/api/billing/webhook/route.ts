import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/billing";

/**
 * Stripe webhook — mirrors absolute subscription state onto the User row
 * rather than incrementing/toggling anything, since Stripe can redeliver or
 * reorder events. Raw body required for signature verification: read with
 * `req.text()`, never `req.json()` first (that would consume/reparse the
 * body and the signature covers the exact original bytes).
 */

// A subscription's billing period lives on its item, not the subscription
// itself, as of this Stripe API version — single-price subscriptions here,
// so the first item is the one that matters.
function periodEndOf(subscription: Stripe.Subscription): Date | null {
  const end = subscription.items.data[0]?.current_period_end;
  return end ? new Date(end * 1000) : null;
}

async function upsertFromSubscription(customerId: string, subscription: Stripe.Subscription) {
  await prisma.user.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      stripeCurrentPeriodEnd: periodEndOf(subscription),
    },
  });
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "billing unavailable" }, { status: 503 });

  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (customerId && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertFromSubscription(customerId, subscription);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      await upsertFromSubscription(customerId, subscription);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
