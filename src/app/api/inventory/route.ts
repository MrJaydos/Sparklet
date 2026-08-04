import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Most recent pending reader suggestions woven into a category's prompt —
// capped so one prolific requester can't crowd out a whole batch.
const SUGGESTED_TOPICS_PER_CATEGORY = 8;

/**
 * Public aggregate inventory, consumed by the scheduled content top-up job
 * (which runs in CI without database access). Exposes card counts, titles,
 * and pending reader-suggested topics (id + text only) — nothing tied to
 * who suggested it.
 *
 * Counts cover STANDARD cards only: depth variants (SIMPLE/DEEP) are never
 * served as feed items, so including them would overstate the bank.
 *
 * `maxSeen` is the demand signal: the highest number of this category's
 * feed cards any single recently-active user has been exposed to — any
 * interaction row, not just a completed read. A fast skip earns nothing but
 * still permanently excludes the card from that user's feed (see
 * getFeedCards's `unseen` query), so it depletes their pool exactly like a
 * real read does; counting only completed reads here undercounted true
 * exhaustion for anyone who skims quickly. The top-up job raises a
 * category's minimum bank above this, so heavy readers/skimmers don't run
 * out of unseen cards while the global count still looks healthy.
 */
export async function GET() {
  const [categories, demand] = await Promise.all([
    prisma.category.findMany({
      orderBy: { slug: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        cards: {
          where: { depthLevel: "STANDARD" },
          select: { title: true, published: true, modelUsed: true },
        },
        suggestions: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          take: SUGGESTED_TOPICS_PER_CATEGORY,
          select: { id: true, topic: true },
        },
      },
    }),
    prisma.$queryRaw<{ categoryId: string; maxSeen: number }[]>`
      SELECT s."categoryId", max(s.seen)::int AS "maxSeen"
      FROM (
        SELECT c."categoryId", i."userId", count(*) AS seen
        FROM "UserCardInteraction" i
        JOIN "Card" c ON c.id = i."cardId"
        JOIN "User" u ON u.id = i."userId"
        WHERE c.published
          AND c."depthLevel" = 'STANDARD'
          AND u."lastActiveDate" >= now() - interval '14 days'
        GROUP BY c."categoryId", i."userId"
      ) s
      GROUP BY s."categoryId"
    `,
  ]);
  const maxSeenByCategory = new Map(demand.map((d) => [d.categoryId, d.maxSeen]));

  return NextResponse.json({
    categories: categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      publishedCount: c.cards.filter((k) => k.published).length,
      // Published cards from the fallback provider (Groq/llama). The top-up
      // job treats these as replaceable — they don't count toward a
      // category's bank, so Gemini replacements get generated and the
      // deploy-time importer retires them once the bank allows.
      groqPublished: c.cards.filter(
        (k) => k.published && k.modelUsed && !k.modelUsed.toLowerCase().includes("gemini")
      ).length,
      totalCount: c.cards.length,
      maxSeen: maxSeenByCategory.get(c.id) ?? 0,
      titles: c.cards.map((k) => k.title),
      suggestedTopics: c.suggestions,
    })),
  });
}
