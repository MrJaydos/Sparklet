import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Public aggregate inventory, consumed by the scheduled content top-up job
 * (which runs in CI without database access). Exposes only card counts and
 * titles — nothing user-related.
 *
 * Counts cover STANDARD cards only: depth variants (SIMPLE/DEEP) are never
 * served as feed items, so including them would overstate the bank.
 *
 * `maxSeen` is the demand signal: the highest number of this category's
 * feed cards any single recently-active user has completed. The top-up job
 * raises a category's minimum bank above it, so heavy readers don't run out
 * of unseen cards while the global count still looks healthy.
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
          select: { title: true, published: true },
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
        WHERE i.completed
          AND c.published
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
      totalCount: c.cards.length,
      maxSeen: maxSeenByCategory.get(c.id) ?? 0,
      titles: c.cards.map((k) => k.title),
    })),
  });
}
