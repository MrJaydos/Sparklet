import { prisma } from "@/lib/db";

export type FeedCard = {
  id: string;
  type: "TEXT_IMAGE" | "VIDEO";
  title: string;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  sources: { title: string; publisher: string; url: string }[];
  readMoreUrl: string;
  liked: boolean;
  seen: boolean;
  score: number;
  myVote: number;
  commentCount: number;
  category: { slug: string; name: string; colorHex: string; icon: string };
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Weighted sampling without replacement (Efraimidis–Spirakis A-Res): each
 * card's chance of surfacing early scales with its community score, while
 * low-scored cards still appear — just less often. Used for the
 * Random/Everything feed.
 */
function weightedShuffle<T extends { score: number }>(arr: T[]): T[] {
  return arr
    .map((item) => {
      const weight = Math.max(0.5, 3 + item.score);
      return { item, key: Math.pow(Math.random(), 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .map((e) => e.item);
}

/**
 * Unseen, published cards for a user, shuffled. When the pool is exhausted
 * and `allowRepeats` is set, falls back to previously seen cards (the UI
 * surfaces this honestly rather than repeating silently).
 */
export async function getFeedCards(opts: {
  userId: string;
  categorySlugs?: string[]; // empty/undefined = Random/Everything
  take?: number;
  allowRepeats?: boolean;
  excludeIds?: string[]; // cards already on screen this session
}): Promise<{ cards: FeedCard[]; exhausted: boolean }> {
  const { userId, categorySlugs, allowRepeats, excludeIds } = opts;
  const take = opts.take ?? 10;

  const baseWhere = {
    published: true,
    ...(categorySlugs?.length ? { category: { slug: { in: categorySlugs } } } : {}),
    ...(excludeIds?.length ? { id: { notIn: excludeIds } } : {}),
  };

  const toFeedCard = (
    c: {
      id: string;
      type: "TEXT_IMAGE" | "VIDEO";
      title: string;
      body: string;
      imageUrl: string | null;
      videoUrl: string | null;
      sources: unknown;
      readMoreUrl: string;
      score: number;
      category: { slug: string; name: string; colorHex: string; icon: string };
      interactions: { liked: boolean; vote: number }[];
      _count: { comments: number };
    },
    seen: boolean
  ): FeedCard => ({
    id: c.id,
    type: c.type,
    title: c.title,
    body: c.body,
    imageUrl: c.imageUrl,
    videoUrl: c.videoUrl,
    sources: c.sources as FeedCard["sources"],
    readMoreUrl: c.readMoreUrl,
    liked: c.interactions[0]?.liked ?? false,
    seen,
    score: c.score,
    myVote: c.interactions[0]?.vote ?? 0,
    commentCount: c._count.comments,
    category: c.category,
  });

  const include = {
    category: { select: { slug: true, name: true, colorHex: true, icon: true } },
    interactions: { where: { userId }, select: { liked: true, vote: true } },
    _count: { select: { comments: { where: { hiddenAt: null } } } },
  };

  // Community score weights the Random/Everything feed; pinned-topic feeds
  // stay a pure shuffle so niche topics aren't drowned out.
  const order = categorySlugs?.length ? shuffle : weightedShuffle;

  const unseen = await prisma.card.findMany({
    where: { ...baseWhere, interactions: { none: { userId } } },
    include,
  });

  if (unseen.length > 0) {
    return {
      cards: order(unseen).slice(0, take).map((c) => toFeedCard(c, false)),
      // Only exhausted once nothing unseen remains beyond what we returned
      exhausted: unseen.length <= take,
    };
  }

  if (!allowRepeats) return { cards: [], exhausted: true };

  const seen = await prisma.card.findMany({
    where: { ...baseWhere, interactions: { some: { userId } } },
    include,
  });
  return {
    cards: order(seen).slice(0, take).map((c) => toFeedCard(c, true)),
    exhausted: true,
  };
}
