import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getRelatedCards } from "@/lib/related";
import type { FeedCard } from "@/lib/feed";
import { ARTICLE_MIN_WORDS } from "@/lib/article";
import { normalizeSources } from "@/lib/source-attribution";

// Single-card lookup for the iOS client's card-detail screen — the web's
// equivalent (/card/[id]/page.tsx) queries Prisma directly server-side
// since it renders HTML; this returns the same FeedCard shape the feed
// endpoint already uses so the client can reuse its existing FeedCard
// model/CardView instead of a bespoke detail type. Unlike the web page,
// this never serves an unpublished card to a signed-out caller — the iOS
// client is always authenticated by the time it can reach this screen (see
// AGENTS.md's Invite section: no login-redirect gate to port), so there's
// no public-share-preview case to handle here.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const card = await prisma.card.findUnique({
    where: { id, published: true, depthLevel: "STANDARD" },
    include: {
      category: { select: { slug: true, name: true, colorHex: true, icon: true } },
      interactions: { where: { userId }, select: { vote: true, completed: true } },
      savedBy: { where: { userId }, select: { id: true } },
      _count: { select: { comments: { where: { hiddenAt: null } } } },
    },
  });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const related = (await getRelatedCards([card.id])).get(card.id) ?? [];

  const feedCard: FeedCard = {
    id: card.id,
    type: card.type,
    title: card.title,
    body: card.body,
    imageUrl: card.imageUrl,
    videoUrl: card.videoUrl,
    // Publisher labels re-derived from the URL host, same as the feed —
    // see src/lib/source-attribution.ts.
    sources: normalizeSources((card.sources as FeedCard["sources"]) ?? []),
    readMoreUrl: card.readMoreUrl,
    hasArticle: (card.articleWords ?? 0) >= ARTICLE_MIN_WORDS,
    saved: card.savedBy.length > 0,
    seen: card.interactions[0]?.completed ?? false,
    review: false, // "due for review" is a feed-composition concept, not a property of the card itself
    score: card.score,
    myVote: card.interactions[0]?.vote ?? 0,
    commentCount: card._count.comments,
    depthLevel: card.depthLevel,
    category: card.category,
    createdAt: card.createdAt.toISOString(),
    related,
  };

  return NextResponse.json(feedCard);
}
