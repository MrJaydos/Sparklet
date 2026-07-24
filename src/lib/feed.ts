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
  depthLevel: "SIMPLE" | "STANDARD" | "DEEP" | "EXTRA_DEEP";
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

// A due spaced-repetition review, rendered as a question instead of the
// repeated card — same shape as FeedQuiz; answering it (right or wrong)
// grades the review via /api/reviews/[id]/answer instead of /api/quiz.
// `sourceCardId` lets the client exclude it from future fetches once shown,
// same as a plain review card already does by virtue of sitting in `cards`.
export type FeedReviewQuiz = FeedQuiz & { sourceCardId: string };

// Guess-before-reveal challenge; the answer stays server-side until the
// user locks in a guess.
export type FeedGuess = {
  id: string;
  prompt: string;
  min: number;
  max: number;
  unit: string;
  integer: boolean; // whether the answer is a whole number, so the slider steps in integers
  category: { slug: string; name: string; colorHex: string; icon: string };
};

// Predict-then-reveal challenge; the true/false answer stays server-side
// until the user commits to a guess — same unseen-required timing as guesses.
export type FeedMisconception = {
  id: string;
  claim: string;
  category: { slug: string; name: string; colorHex: string; icon: string };
};

// Free-recall prompt: explain an already-read card back in your own words.
// `id` is the source Card's id (there's no separate authored content —
// unlike quiz/guess/misconception, this is graded live by an LLM against the
// card body, not pre-generated).
export type FeedExplainPrompt = {
  id: string;
  title: string;
  body: string;
  category: { slug: string; name: string; colorHex: string; icon: string };
};

const EXPLAIN_MIN_BODY_WORDS = 30; // trivial one-liners aren't worth explaining back

// Reviews are capped at roughly 1 in 7 cards so a short session doesn't read
// as "all review cards" — a flat per-batch cap used to dominate small
// batches regardless of `take`.
const REVIEW_RATIO = 0.15;

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
 * Spreads `items` evenly through `rest` instead of bunching them at the
 * front — e.g. 2 reviews across 8 new cards land around positions 3 and 6,
 * not both before the first new card.
 */
function interleave<T>(items: T[], rest: T[]): T[] {
  if (items.length === 0) return rest;
  const out: T[] = [];
  const stride = (rest.length + 1) / (items.length + 1);
  let itemIdx = 0;
  let nextInsertAt = stride;
  for (const r of rest) {
    out.push(r);
    if (itemIdx < items.length && out.length >= nextInsertAt) {
      out.push(items[itemIdx++]);
      nextInsertAt += stride;
    }
  }
  while (itemIdx < items.length) out.push(items[itemIdx++]);
  return out;
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
  depthLevel: "SIMPLE" | "STANDARD" | "DEEP" | "EXTRA_DEEP";
  createdAt: Date;
  category: { slug: string; name: string; colorHex: string; icon: string };
  interactions: { vote: number }[];
  savedBy: { id: string }[];
  _count: { comments: number };
};

/**
 * Unseen, published cards for a user, shuffled — with due spaced-repetition
 * reviews spread through the batch (capped at roughly 1 in 4 cards, never
 * bunched at the front) and recall quizzes returned alongside. When
 * the pool is exhausted and `allowRepeats` is set, falls back to previously
 * seen cards (the UI surfaces this honestly rather than repeating silently).
 */
// Never a real cuid, so every `where: { userId }` clause below naturally
// resolves to "nothing seen/saved/reviewed" for a signed-out visitor —
// no personalization branching needed anywhere in this function.
const GUEST_SENTINEL = "__guest__";

export async function getFeedCards(opts: {
  userId: string | null;
  categorySlugs?: string[]; // empty/undefined = Random/Everything
  take?: number;
  allowRepeats?: boolean;
  excludeIds?: string[]; // cards already on screen this session
}): Promise<{
  cards: FeedCard[];
  quizzes: FeedQuiz[];
  reviewQuizzes: FeedReviewQuiz[];
  guesses: FeedGuess[];
  misconceptions: FeedMisconception[];
  explainPrompts: FeedExplainPrompt[];
  exhausted: boolean;
}> {
  const { categorySlugs, allowRepeats, excludeIds } = opts;
  const userId = opts.userId ?? GUEST_SENTINEL;
  const take = opts.take ?? 10;
  const reviewCap = Math.max(1, Math.floor(take * REVIEW_RATIO));

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

  // Due reviews — the retention mechanism, capped at ~1 in 4 cards (see
  // REVIEW_RATIO) and spread through the batch rather than front-loaded, so
  // a short session doesn't read as "all review cards". A card with a quiz
  // is served as a question instead of the repeated card;
  // cards without one (pre-dates every-card quiz generation) fall back to
  // the plain repeated-card review.
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
    take: reviewCap,
    select: {
      card: {
        include: {
          ...include,
          quizCards: {
            take: 1,
            orderBy: { createdAt: "asc" },
            select: { id: true, question: true, options: true },
          },
        },
      },
    },
  });
  const reviewCards: FeedCard[] = [];
  const reviewQuizzes: FeedReviewQuiz[] = [];
  for (const s of dueStates) {
    const card = s.card as CardRow & {
      quizCards: { id: string; question: string; options: unknown }[];
    };
    const quiz = card.quizCards[0];
    if (quiz) {
      reviewQuizzes.push({
        id: quiz.id,
        question: quiz.question,
        options: quiz.options as string[],
        category: card.category,
        sourceCardId: card.id,
      });
    } else {
      reviewCards.push(toFeedCard(card, true, true));
    }
  }
  const reviewQuizIds = new Set(reviewQuizzes.map((q) => q.id));
  // Cards already spoken for as a review this batch — either the plain
  // fallback card itself, or the source card behind a review-quiz — must not
  // also show up in the regular unseen/seen pool below as if unrelated.
  const dueCardIds = new Set([
    ...reviewCards.map((c) => c.id),
    ...reviewQuizzes.map((q) => q.sourceCardId),
  ]);

  // Recall quizzes: fact already seen, quiz not yet attempted. Client mixes
  // ~1 per 5 cards. Sample a wide pool and shuffle — a bare `take` always
  // returns the same head rows, which the client then dedupes into starvation
  // (quizzes stop appearing mid-session on the Everything feed).
  // For guests this is always empty — "already seen" has no meaning without
  // a tracked session, so there's nothing to recall-check yet.
  const quizRows = await prisma.quizCard.findMany({
    where: {
      card: {
        published: true,
        ...categoryFilter,
        interactions: { some: { userId, completed: true } },
      },
      attempts: { none: { userId } },
      // A card can enter the review schedule via a long dwell without its
      // checkpoint quiz ever being attempted — exclude quizzes already
      // being served as a due review this batch so they don't double-appear.
      ...(reviewQuizIds.size ? { id: { notIn: [...reviewQuizIds] } } : {}),
    },
    take: 40,
    select: {
      id: true,
      question: true,
      options: true,
      card: {
        select: { category: { select: { slug: true, name: true, colorHex: true, icon: true } } },
      },
    },
  });
  const quizzes: FeedQuiz[] = shuffle(quizRows)
    .slice(0, Math.max(1, Math.ceil(take / 5)) + 1)
    .map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options as string[],
    category: q.card.category,
  }));

  // Guess-before-reveal: the fact must still be UNSEEN — guessing is only
  // fun before you've read the answer. Same wide-pool-then-shuffle shape.
  const guessRows = await prisma.guessCard.findMany({
    where: {
      card: {
        published: true,
        ...categoryFilter,
        interactions: { none: { userId } },
      },
      attempts: { none: { userId } },
    },
    take: 30,
    select: {
      id: true,
      prompt: true,
      min: true,
      max: true,
      unit: true,
      answer: true,
      card: {
        select: { category: { select: { slug: true, name: true, colorHex: true, icon: true } } },
      },
    },
  });
  const guesses: FeedGuess[] = shuffle(guessRows)
    .slice(0, Math.max(1, Math.ceil(take / 8)) + 1)
    .map((g) => ({
      id: g.id,
      prompt: g.prompt,
      min: g.min,
      max: g.max,
      unit: g.unit,
      // Not "answer" itself — just whether it happens to be a whole number,
      // so the slider can step in integers instead of e.g. "5.62 patients".
      integer: Number.isInteger(g.min) && Number.isInteger(g.max) && Number.isInteger(g.answer),
      category: g.card.category,
    }));

  // Predict-then-reveal: same unseen-required timing as guesses (committing
  // to true/false only makes sense before the correction is shown).
  const misconceptionRows = await prisma.misconceptionCard.findMany({
    where: {
      card: {
        published: true,
        ...categoryFilter,
        interactions: { none: { userId } },
      },
      attempts: { none: { userId } },
    },
    take: 30,
    select: {
      id: true,
      claim: true,
      card: {
        select: { category: { select: { slug: true, name: true, colorHex: true, icon: true } } },
      },
    },
  });
  const misconceptions: FeedMisconception[] = shuffle(misconceptionRows)
    .slice(0, Math.max(1, Math.ceil(take / 10)) + 1)
    .map((m) => ({ id: m.id, claim: m.claim, category: m.card.category }));

  // Explain-it-back: free recall of a fact already seen — same timing as
  // quiz (completed, not yet attempted), not guess/misconception's
  // unseen-required timing, since there's nothing to recall before reading.
  const explainRows = await prisma.card.findMany({
    where: {
      published: true,
      depthLevel: "STANDARD" as const,
      ...categoryFilter,
      interactions: { some: { userId, completed: true } },
      explanationAttempts: { none: { userId } },
    },
    take: 40,
    select: {
      id: true,
      title: true,
      body: true,
      category: { select: { slug: true, name: true, colorHex: true, icon: true } },
    },
  });
  const explainPrompts: FeedExplainPrompt[] = shuffle(
    explainRows.filter((c) => c.body.split(/\s+/).length >= EXPLAIN_MIN_BODY_WORDS)
  )
    .slice(0, Math.max(1, Math.ceil(take / 8)) + 1)
    .map((c) => ({ id: c.id, title: c.title, body: c.body, category: c.category }));

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

  const newTake = Math.max(0, take - reviewCards.length - reviewQuizzes.length);

  // New users should recognize their onboarding picks immediately: front-load
  // ~70% of the batch from chosen topics, then blend in everything else.
  // (The ×3 weight boost alone was too subtle — first swipes looked random.)
  const compose = (rows: CardRow[]) => {
    const ordered = order(rows);
    if (!boostSlugs) return ordered;
    const boost: CardRow[] = [];
    const rest: CardRow[] = [];
    for (const c of ordered) (boostSlugs.has(c.category.slug) ? boost : rest).push(c);
    const head = boost.slice(0, Math.ceil(newTake * 0.7));
    return [...head, ...shuffle([...rest, ...boost.slice(head.length)])];
  };

  const unseen = (await prisma.card.findMany({
    where: { ...baseWhere, interactions: { none: { userId } } },
    include,
  })) as CardRow[];

  if (unseen.length > 0) {
    return {
      cards: await withRelated(
        interleave(
          reviewCards,
          compose(unseen)
            .filter((c) => !dueCardIds.has(c.id))
            .slice(0, newTake)
            .map((c) => toFeedCard(c, false))
        )
      ),
      quizzes,
      reviewQuizzes,
      guesses,
      misconceptions,
      explainPrompts,
      exhausted: unseen.length <= newTake,
    };
  }

  if (!allowRepeats) {
    return {
      cards: await withRelated(reviewCards),
      quizzes,
      reviewQuizzes,
      guesses,
      misconceptions,
      explainPrompts,
      exhausted: true,
    };
  }

  const seen = (await prisma.card.findMany({
    where: { ...baseWhere, interactions: { some: { userId } } },
    include,
  })) as CardRow[];
  return {
    cards: await withRelated(
      interleave(
        reviewCards,
        compose(seen)
          .filter((c) => !dueCardIds.has(c.id))
          .slice(0, newTake)
          .map((c) => toFeedCard(c, true))
      )
    ),
    quizzes,
    reviewQuizzes,
    guesses,
    misconceptions,
    explainPrompts,
    exhausted: true,
  };
}
