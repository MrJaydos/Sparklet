import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getFeedCards } from "@/lib/feed";
import { getXpToday, DAILY_GOAL_XP } from "@/lib/xp";
import { Feed } from "@/components/feed/Feed";

export const metadata = { title: "Feed — Sparklet" };
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [categories, feed, user, unread] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { slug: true, name: true, colorHex: true, icon: true },
    }),
    getFeedCards({ userId, take: 10 }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        currentStreak: true,
        longestStreak: true,
        streakFreezesAvailable: true,
        onboardedAt: true,
        _count: { select: { interactions: true } },
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  // Client timezone comes from a cookie the feed sets on first visit;
  // without it (first ever load) UTC approximates and the first
  // interaction response corrects the ring.
  const tzRaw = Number((await cookies()).get("sparklet.tz")?.value);
  const xpToday = await getXpToday(userId, Number.isFinite(tzRaw) ? tzRaw : 0);

  // First session: offer interest onboarding (skippable, one-time).
  if (!user.onboardedAt && user._count.interactions === 0) redirect("/onboarding");

  return (
    <Feed
      initialCards={feed.cards}
      initialQuizzes={feed.quizzes}
      initialGuesses={feed.guesses}
      initialExhausted={feed.exhausted}
      categories={categories}
      initialStreak={user.currentStreak}
      initialLongestStreak={user.longestStreak}
      initialFreezesAvailable={user.streakFreezesAvailable}
      initialUnread={unread}
      initialXpToday={xpToday}
      dailyGoal={DAILY_GOAL_XP}
    />
  );
}
