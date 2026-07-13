import { prisma } from "@/lib/db";
import { getRelatedCards, type RelatedLink } from "@/lib/related";

export type FeedCard = {
  id: string;
  type: "TEXT_IMAGE" | "VIDEO";
  title: string;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  sources: { title: string; publisher: string; url: string }[];
  readMoreUrl: string;
  saved: boolean;
  seen: boolean;
  review: boolean; // due spaced-repetition review, surfaced near the top
  score: number;
  myVote: number;
  commentCount: number;
  depthLevel: "SIMPLE" | "STANDARD" | "DEEP";
  category: { slug: string; name: string; colorHex: string; icon: string };
  createdAt: string; // ISO — freshness signal ("published X ago")
  related: RelatedLink[]; // light-touch "this connects to…" trail
};

export type FeedQuiz = {
  id: string;
  question: string;
  options: string[];
  category: { slug: string; name: string; colorHex: string; icon: string };
};

const REVIEWS_PER_BATCH = 3;
const NEW_USER_VIEW_LIMIT = 50; // interest weighting only shapes early sessions

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
 * card's chance of surfacing early scales with its community score (and an
 * interest boost for new users), while low-scored cards still appear — just
 * less often. Used for the Random/Everything feed.
 */
function weightedShuffle<T extends { score: number; category: { slug: string } }>(
  arr: T[],
  boostSlugs?: Set<string>
): T[] {
  return arr
    .map((item) => {
      let weight = Math.max(0.5, 3 + item.score);
      if (boostSlugs?.has(item.category.slug)) weight *= 3;
      return { item, key: Math.pow(Math.random(), 1 / weight) };
    })
    .sort((a, b) => b.key - a.key)
    .map((e) => e.item);
}

type CardRow = {
  id: string;
  type: "TEXT_IMAGE" | "VIDEO";
  title: string;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  sources: unknown;
  readMoreUrl: string;
  score: number;
  depthLevel: "SIMPLE" | "STANDARD" | "DEEP";
  createdAt: Date;
  category: { slug: string; name: string; colorHex: string; icon: string };
  interactions: { vote: number }[];
  savedBy: { id: string }[];
  _count: { comments: number };
};

/**
 * Unseen, published cards for a user, shuffled — with due spaced-repetition
 * reviews slotted at the front and recall quizzes returned alongside. When
 * the pool is exhausted and `allowRepeats` is set, falls back to previously
 * seen cards (the UI surfaces this honestly rather than repeating silently).
 */
export async function getFeedCards(opts: {
  userId: string;
  categorySlugs?: string[]; // empty/undefined = Random/Everything
  take?: number;
  allowRepeats?: boolean;
  excludeIds?: string[]; // cards already on screen this session
}): Promise<{ cards: FeedCard[]; quizzes: FeedQuiz[]; exhausted: boolean }> {
  const { userId, categorySlugs, allowRepeats, excludeIds } = opts;
  const take = opts.take ?? 10;

  const categoryFilter = categorySlugs?.length
    ? { category: { slug: { in: categorySlugs } } }
    : {};
  const baseWhere = {
    published: true,
    // Depth variants (SIMPLE/DEEP) are reached via the toggle on their
    // standard card, never served as separate feed items.
    depthLevel: "STANDARD" as const,
    ...categoryFilter,
    ...(excludeIds?.length ? { id: { notIn: excludeIds } } : {}),
  };

  const toFeedCard = (c: CardRow, seen: boolean, review = false): FeedCard => ({
    id: c.id,
    type: c.type,
    title: c.title,
    body: c.body,
    imageUrl: c.imageUrl,
    videoUrl: c.videoUrl,
    sources: c.sources as FeedCard["sources"],
    readMoreUrl: c.readMoreUrl,
    saved: c.savedBy.length > 0,
    seen,
    review,
    score: c.score,
    myVote: c.interactions[0]?.vote ?? 0,
    commentCount: c._count.comments,
    depthLevel: c.depthLevel,
    category: c.category,
    createdAt: c.createdAt.toISOString(),
    related: [], // filled in withRelated once the batch is assembled
  });

  const withRelated = async (cards: FeedCard[]) => {
    const rel = await getRelatedCards(cards.map((c) => c.id));
    for (const c of cards) c.related = rel.get(c.id) ?? [];
    return cards;
  };

  const include = {
    category: { select: { slug: true, name: true, colorHex: true, icon: true } },
    interactions: { where: { userId }, select: { vote: true } },
    savedBy: { where: { userId }, select: { id: true } },
    _count: { select: { comments: { where: { hiddenAt: null } } } },
  };

  // Due reviews — the retention mechanism. Slotted at the front of the batch.
  const dueStates = await prisma.spacedRepetitionState.findMany({
    where: {
      userId,
      nextReviewAt: { lte: new Date() },
      card: {
        published: true,
        depthLevel: "STANDARD" as const,
        ...categoryFilter,
        ...(excludeIds?.length ? { id: { notIn: excludeIds } } : {}),
      },
    },
    orderBy: { nextReviewAt: "asc" },
    take: REVIEWS_PER_BATCH,
    select: { card: { include } },
  });
  const reviewCards = dueStates.map((s) => toFeedCard(s.card as CardRow, true, true));
  const reviewIds = new Set(reviewCards.map((c) => c.id));

  // Recall quizzes: fact already seen, quiz not yet attempted. Client mixes
  // ~1 per 8-10 cards.
  const quizRows = await prisma.quizCard.findMany({
    where: {
      card: {
        published: true,
        ...categoryFilter,
        interactions: { some: { userId, completed: true } },
      },
      attempts: { none: { userId } },
    },
    take: Math.max(1, Math.ceil(take / 8)) + 1,
    select: {
      id: true,
      question: true,
      options: true,
      card: {
        select: { category: { select: { slug: true, name: true, colorHex: true, icon: true } } },
      },
    },
  });
  const quizzes: FeedQuiz[] = shuffle(quizRows).map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options as string[],
    category: q.card.category,
  }));

  // Interest boost, only while the user is new and only in Everything mode.
  let boostSlugs: Set<string> | undefined;
  if (!categorySlugs?.length) {
    const [interests, viewCount] = await Promise.all([
      prisma.userInterest.findMany({
        where: { userId },
        select: { category: { select: { slug: true } } },
      }),
      prisma.userCardInteraction.count({ where: { userId, completed: true } }),
    ]);
    if (interests.length && viewCount < NEW_USER_VIEW_LIMIT) {
      boostSlugs = new Set(interests.map((i) => i.category.slug));
    }
  }

  // Community score weights the Random/Everything feed; pinned-topic feeds
  // stay a pure shuffle so niche topics aren't drowned out.
  const order = (rows: CardRow[]) =>
    categorySlugs?.length ? shuffle(rows) : weightedShuffle(rows, boostSlugs);

  const newTake = Math.max(0, take - reviewCards.length);

  const unseen = (await prisma.card.findMany({
    where: { ...baseWhere, interactions: { none: { userId } } },
    include,
  })) as CardRow[];

  if (unseen.length > 0) {
    return {
      cards: await withRelated([
        ...reviewCards,
        ...order(unseen)
          .filter((c) => !reviewIds.has(c.id))
          .slice(0, newTake)
          .map((c) => toFeedCard(c, false)),
      ]),
      quizzes,
      exhausted: unseen.length <= newTake,
    };
  }

  if (!allowRepeats) {
    return { cards: await withRelated(reviewCards), quizzes, exhausted: true };
  }

  const seen = (await prisma.card.findMany({
    where: { ...baseWhere, interactions: { some: { userId } } },
    include,
  })) as CardRow[];
  return {
    cards: await withRelated([
      ...reviewCards,
      ...order(seen)
        .filter((c) => !reviewIds.has(c.id))
        .slice(0, newTake)
        .map((c) => toFeedCard(c, true)),
    ]),
    quizzes,
    exhausted: true,
  };
}
