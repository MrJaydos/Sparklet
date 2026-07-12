import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Public aggregate inventory, consumed by the scheduled content top-up job
 * (which runs in CI without database access). Exposes only card counts and
 * titles — nothing user-related.
 */
export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { slug: "asc" },
    select: {
      slug: true,
      name: true,
      description: true,
      cards: { select: { title: true, published: true } },
    },
  });

  return NextResponse.json({
    categories: categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      publishedCount: c.cards.filter((k) => k.published).length,
      totalCount: c.cards.length,
      titles: c.cards.map((k) => k.title),
    })),
  });
}
