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
      category: { slug: string; name: string; colorHex: string; icon: string };
      interactions: { liked: boolean }[];
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
    category: c.category,
  });

  const include = {
    category: { select: { slug: true, name: true, colorHex: true, icon: true } },
    interactions: { where: { userId }, select: { liked: true } },
  };

  const unseen = await prisma.card.findMany({
    where: { ...baseWhere, interactions: { none: { userId } } },
    include,
  });

  if (unseen.length > 0) {
    return {
      cards: shuffle(unseen).slice(0, take).map((c) => toFeedCard(c, false)),
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
    cards: shuffle(seen).slice(0, take).map((c) => toFeedCard(c, true)),
    exhausted: true,
  };
}
