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
 * Message priority: streak genuinely about to break (active yesterday, not
 * yet today — a stale currentStreak from days ago doesn't nag) → reviews
 * due → an unseen-card teaser matched to the user's interests: categories
 * they read and like most, falling back to onboarding picks, then anything.
 */

const EVENING_START = 17;
const EVENING_END = 23; // exclusive
const NUDGE_COOLDOWN_MS = 20 * 3600_000;

/**
 * A random unseen published card from the categories this user engages with
 * most — reads in the last 60 days, with likes weighted extra — falling back
 * to their onboarding interest picks, then to any category.
 */
async function pickTeaser(
  userId: string
): Promise<{ id: string; title: string; categoryName: string; icon: string } | null> {
  const behavioral = await prisma.$queryRaw<{ categoryId: string }[]>`
    SELECT c."categoryId"
    FROM "UserCardInteraction" i
    JOIN "Card" c ON c.id = i."cardId"
    WHERE i."userId" = ${userId}
      AND i.completed
      AND (i."viewedAt" >= now() - interval '60 days' OR i.liked)
    GROUP BY c."categoryId"
    ORDER BY count(*) + 2 * count(*) FILTER (WHERE i.liked) DESC
    LIMIT 3
  `;
  let categoryIds = behavioral.map((r) => r.categoryId);
  if (categoryIds.length === 0) {
    const interests = await prisma.userInterest.findMany({
      where: { userId },
      select: { categoryId: true },
    });
    categoryIds = interests.map((i) => i.categoryId);
  }

  // Preferred categories first; anything unseen as the last resort.
  for (const where of [
    ...(categoryIds.length ? [{ categoryId: { in: categoryIds } }] : []),
    {},
  ]) {
    const filter = {
      ...where,
      published: true,
      depthLevel: "STANDARD" as const,
      interactions: { none: { userId } },
    };
    const count = await prisma.card.count({ where: filter });
    if (count === 0) continue;
    const card = await prisma.card.findFirst({
      where: filter,
      skip: Math.floor(Math.random() * count),
      select: {
        id: true,
        title: true,
        category: { select: { name: true, icon: true } },
      },
    });
    if (card) {
      return {
        id: card.id,
        title: card.title,
        categoryName: card.category.name,
        icon: card.category.icon,
      };
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const token = process.env.REVALIDATE_TOKEN;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || provided !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured) {
    return NextResponse.json({ sent: 0, note: "push not configured (VAPID keys unset)" });
  }

  // ?test=1: fire an immediate test notification to every subscription,
  // bypassing the evening/active-today/cooldown filters — for verifying
  // delivery end to end. Doesn't consume the daily nudge.
  if (req.nextUrl.searchParams.get("test")) {
    const subscribed = await prisma.user.findMany({
      where: { pushSubscriptions: { some: {} } },
      select: { id: true },
    });
    let sent = 0;
    for (const u of subscribed) {
      sent += await pushToUser(u.id, {
        title: "🔔 Test push",
        body: "If you see this, delivery works.",
        url: "/feed",
      });
    }
    return NextResponse.json({ test: true, subscribers: subscribed.length, sent });
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
    // Only warn about the streak while it can still be saved tonight: they
    // were active yesterday and haven't been in today. A currentStreak left
    // over from days ago is stale — nagging about it reads as a lie.
    const streakAtRisk =
      user.currentStreak > 0 && user.lastActiveDate?.getTime() === today - 86_400_000;

    const dueReviews = await prisma.spacedRepetitionState.count({
      where: { userId: user.id, nextReviewAt: { lte: new Date() }, card: { published: true } },
    });

    let payload: PushPayload;
    if (streakAtRisk) {
      payload = {
        title: `🔥 ${user.currentStreak}-day streak on the line`,
        body:
          dueReviews > 0
            ? `${dueReviews} review${dueReviews === 1 ? "" : "s"} due — fastest way to save it.`
            : "10 cards before midnight, or it's toast.",
        url: "/feed",
      };
    } else if (dueReviews > 0) {
      payload = {
        title: `🔁 ${dueReviews} card${dueReviews === 1 ? "" : "s"} ready for review`,
        body: "A quick recall locks them in.",
        url: "/feed",
      };
    } else {
      const teaser = await pickTeaser(user.id);
      if (!teaser) continue;
      payload = {
        title: `${teaser.icon} ${teaser.categoryName}: did you know?`,
        body: teaser.title,
        url: `/card/${teaser.id}`,
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
