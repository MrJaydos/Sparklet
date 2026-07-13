import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getFeedCards } from "@/lib/feed";
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
        onboardedAt: true,
        _count: { select: { interactions: true } },
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  // First session: offer interest onboarding (skippable, one-time).
  if (!user.onboardedAt && user._count.interactions === 0) redirect("/onboarding");

  return (
    <Feed
      initialCards={feed.cards}
      initialQuizzes={feed.quizzes}
      initialExhausted={feed.exhausted}
      categories={categories}
      initialStreak={user.currentStreak}
      initialUnread={unread}
    />
  );
}
