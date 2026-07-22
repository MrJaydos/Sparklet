import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { getFeedCards } from "@/lib/feed";
import { getXpToday, getCardsToday, DAILY_GOAL_XP } from "@/lib/xp";
import { isAdminEmail } from "@/lib/admin";
import { getUnreadCount } from "@/lib/notifications";
import { isBillingEnabled } from "@/lib/billing";
import { Feed } from "@/components/feed/Feed";

export const metadata = { title: "Feed — Sparklet" };
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Signed out: browse the same live feed, no personalization — reads,
  // saves, comments, and quiz/guess answers all prompt sign-in on interact.
  if (!userId) {
    const [categories, feed] = await Promise.all([
      prisma.category.findMany({
        orderBy: { name: "asc" },
        select: { slug: true, name: true, colorHex: true, icon: true },
      }),
      getFeedCards({ userId: null, take: 10 }),
    ]);

    async function signOutAction() {
      "use server";
      await signOut({ redirectTo: "/" });
    }

    return (
      <Feed
        initialCards={feed.cards}
        initialQuizzes={feed.quizzes}
        initialReviewQuizzes={feed.reviewQuizzes}
        initialGuesses={feed.guesses}
        initialMisconceptions={feed.misconceptions}
        initialExplainPrompts={feed.explainPrompts}
        initialExhausted={feed.exhausted}
        categories={categories}
        initialStreak={0}
        initialLongestStreak={0}
        initialFreezesAvailable={0}
        initialUnread={0}
        initialXpToday={0}
        dailyGoal={DAILY_GOAL_XP}
        initialCardsToday={0}
        inviteUrl=""
        isAdmin={false}
        isGuest
        premium={false}
        billingEnabled={isBillingEnabled()}
        signOutAction={signOutAction}
      />
    );
  }

  const isAdmin = isAdminEmail(session?.user?.email);

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
    getUnreadCount(userId, isAdmin),
  ]);
  // Client timezone comes from a cookie the feed sets on first visit;
  // without it (first ever load) UTC approximates and the first
  // interaction response corrects the ring.
  const tzRaw = Number((await cookies()).get("sparklet.tz")?.value);
  const tz = Number.isFinite(tzRaw) ? tzRaw : 0;
  const [xpToday, cardsToday] = await Promise.all([
    getXpToday(userId, tz),
    getCardsToday(userId, tz),
  ]);

  // First session: offer interest onboarding (skippable, one-time).
  if (!user.onboardedAt && user._count.interactions === 0) redirect("/onboarding");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <Feed
      initialCards={feed.cards}
      initialQuizzes={feed.quizzes}
      initialReviewQuizzes={feed.reviewQuizzes}
      initialGuesses={feed.guesses}
      initialMisconceptions={feed.misconceptions}
      initialExplainPrompts={feed.explainPrompts}
      initialExhausted={feed.exhausted}
      categories={categories}
      initialStreak={user.currentStreak}
      initialLongestStreak={user.longestStreak}
      initialFreezesAvailable={user.streakFreezesAvailable}
      initialUnread={unread}
      initialXpToday={xpToday}
      dailyGoal={DAILY_GOAL_XP}
      initialCardsToday={cardsToday}
      inviteUrl={`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/invite/${userId}`}
      isAdmin={isAdmin}
      isGuest={false}
      premium={session?.user?.premium ?? false}
      billingEnabled={isBillingEnabled()}
      signOutAction={signOutAction}
    />
  );
}
