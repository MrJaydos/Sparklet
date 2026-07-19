import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushToUser, pushConfigured, type PushPayload } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Daily push nudge, called by a GitHub Actions cron every couple of hours
 * (Authorization: Bearer $REVALIDATE_TOKEN — the shared cron secret). Each
 * call decides per user, in their own timezone, whether it's nudge o'clock:
 *
 *  - only during their local evening (17:00–22:59) — the caller doesn't
 *    need to know anyone's timezone, it just calls regularly;
 *  - at most one nudge per ~day (lastNudgedAt guard);
 *  - never for users who've already been active today — nudges are for
 *    bringing people back, not interrupting them.
 *
 * Message priority: streak about to break → reviews due → a random unseen
 * card as a discovery teaser.
 */

const EVENING_START = 17;
const EVENING_END = 23; // exclusive
const NUDGE_COOLDOWN_MS = 20 * 3600_000;

export async function POST(req: NextRequest) {
  const token = process.env.REVALIDATE_TOKEN;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || provided !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured) {
    return NextResponse.json({ sent: 0, note: "push not configured (VAPID keys unset)" });
  }

  const users = await prisma.user.findMany({
    where: { pushSubscriptions: { some: {} } },
    select: {
      id: true,
      currentStreak: true,
      lastActiveDate: true,
      tzOffsetMinutes: true,
      lastNudgedAt: true,
    },
  });

  let sent = 0;
  const now = Date.now();
  for (const user of users) {
    if (user.lastNudgedAt && now - user.lastNudgedAt.getTime() < NUDGE_COOLDOWN_MS) continue;

    const offset = Math.max(-840, Math.min(840, user.tzOffsetMinutes ?? 0));
    const localNow = new Date(now - offset * 60_000);
    const hour = localNow.getUTCHours();
    if (hour < EVENING_START || hour >= EVENING_END) continue;

    // Same convention as streak.ts: local calendar day stored as UTC midnight.
    const today = Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate()
    );
    if (user.lastActiveDate?.getTime() === today) continue; // already learned today

    const dueReviews = await prisma.spacedRepetitionState.count({
      where: { userId: user.id, nextReviewAt: { lte: new Date() }, card: { published: true } },
    });

    let payload: PushPayload;
    if (user.currentStreak > 0) {
      payload = {
        title: `🔥 Your ${user.currentStreak}-day streak is on the line`,
        body:
          dueReviews > 0
            ? `One card keeps it alive — and ${dueReviews} review${dueReviews === 1 ? " is" : "s are"} ready.`
            : "One card before midnight keeps it alive.",
        url: "/feed",
      };
    } else if (dueReviews > 0) {
      payload = {
        title: `🔁 ${dueReviews} card${dueReviews === 1 ? "" : "s"} ready for review`,
        body: "A quick recall now locks them into memory.",
        url: "/feed",
      };
    } else {
      // Discovery teaser: a random published card this user hasn't seen.
      const unseenCount = await prisma.card.count({
        where: {
          published: true,
          depthLevel: "STANDARD",
          interactions: { none: { userId: user.id } },
        },
      });
      if (unseenCount === 0) continue;
      const teaser = await prisma.card.findFirst({
        where: {
          published: true,
          depthLevel: "STANDARD",
          interactions: { none: { userId: user.id } },
        },
        skip: Math.floor(Math.random() * unseenCount),
        select: { title: true },
      });
      if (!teaser) continue;
      payload = {
        title: "🔮 Did you know?",
        body: teaser.title,
        url: "/feed",
      };
    }

    const delivered = await pushToUser(user.id, payload);
    if (delivered > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { lastNudgedAt: new Date() } });
      sent++;
    }
  }

  return NextResponse.json({ candidates: users.length, sent });
}
