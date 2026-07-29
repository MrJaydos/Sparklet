import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/display";
import { computeBadges } from "@/lib/badges";

// Everything on the web profile page (src/app/profile/page.tsx) beyond the
// lightweight xp/streak numbers already served by GET /api/profile — badges,
// history, notebook (saved cards), top categories, and due-reviews count —
// only ever ran as part of that page's own server-side query, with nothing
// a client could call. Split into its own route (rather than folded into
// GET /api/profile) since that one is polled on every feed load and this
// data is only needed when the Profile screen itself opens. Friends/
// friendCode are deliberately NOT duplicated here — GET /api/friends
// already covers that.
function formatWhen(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [
    user,
    totalViewed,
    categoryGroups,
    history,
    savedCards,
    dueReviews,
    quizzesCorrect,
    guessesAnswered,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        currentStreak: true,
        longestStreak: true,
        streakFreezesAvailable: true,
        xp: true,
      },
    }),
    prisma.userCardInteraction.count({ where: { userId, completed: true } }),
    prisma.userCardInteraction.groupBy({
      by: ["cardId"],
      where: { userId, completed: true },
      _count: true,
    }).then(async (rows) => {
      if (rows.length === 0) return { top: [], total: 0 };
      const cards = await prisma.card.findMany({
        where: { id: { in: rows.map((r) => r.cardId) } },
        select: { category: { select: { name: true, icon: true, colorHex: true } } },
      });
      const counts = new Map<string, { name: string; icon: string; colorHex: string; count: number }>();
      for (const c of cards) {
        const cur = counts.get(c.category.name) ?? { ...c.category, count: 0 };
        cur.count++;
        counts.set(c.category.name, cur);
      }
      const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
      return { top: sorted.slice(0, 5), total: sorted.length };
    }),
    prisma.userCardInteraction.findMany({
      where: { userId, completed: true },
      orderBy: { viewedAt: "desc" },
      take: 50,
      select: {
        viewedAt: true,
        card: {
          select: {
            id: true,
            title: true,
            category: { select: { name: true, icon: true, colorHex: true } },
          },
        },
      },
    }),
    prisma.savedCard.findMany({
      where: { userId },
      orderBy: { savedAt: "desc" },
      take: 100,
      select: {
        card: {
          select: {
            id: true,
            title: true,
            category: { select: { name: true, icon: true, colorHex: true } },
          },
        },
      },
    }),
    prisma.spacedRepetitionState.count({
      where: { userId, nextReviewAt: { lte: new Date() } },
    }),
    prisma.userQuizAttempt.count({ where: { userId, correct: true } }),
    prisma.userGuessAttempt.count({ where: { userId } }),
  ]);

  const badges = computeBadges({
    cards: totalViewed,
    streak: user.longestStreak,
    quiz: quizzesCorrect,
    categories: categoryGroups.total,
    notebook: savedCards.length,
    guess: guessesAnswered,
  });

  return NextResponse.json({
    id: userId,
    name: displayName(user),
    email: user.email,
    xp: user.xp,
    currentStreak: user.currentStreak,
    longestStreak: user.longestStreak,
    freezesAvailable: user.streakFreezesAvailable,
    totalViewed,
    dueReviews,
    badges,
    topCategories: categoryGroups.top,
    savedCards: savedCards.map(({ card }) => ({
      cardId: card.id,
      title: card.title,
      icon: card.category.icon,
      colorHex: card.category.colorHex,
    })),
    history: history.map(({ card, viewedAt }) => ({
      cardId: card.id,
      title: card.title,
      icon: card.category.icon,
      colorHex: card.category.colorHex,
      when: formatWhen(viewedAt),
    })),
  });
}
