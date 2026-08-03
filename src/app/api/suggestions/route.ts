import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Caps the open queue per user — this is free-text input read straight into
// a generation prompt (see scripts/generate-content.ts), so it needs a spam
// ceiling that fixed-enum forms like /api/report don't.
const MAX_PENDING_PER_USER = 5;

const bodySchema = z.object({
  topic: z.string().trim().min(6).max(200),
  categorySlug: z.string().trim().min(1),
});

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const suggestions = await prisma.cardSuggestion.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, topic: true, status: true, createdAt: true, category: { select: { name: true, icon: true } } },
  });
  return NextResponse.json({ suggestions });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { topic, categorySlug } = parsed.data;

  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
    select: { id: true },
  });
  if (!category) return NextResponse.json({ error: "unknown category" }, { status: 404 });

  const pendingCount = await prisma.cardSuggestion.count({
    where: { userId, status: "PENDING" },
  });
  if (pendingCount >= MAX_PENDING_PER_USER) {
    return NextResponse.json(
      { error: `You already have ${pendingCount} suggestions waiting on cards — give those a chance to land first.` },
      { status: 429 }
    );
  }

  const suggestion = await prisma.cardSuggestion.create({
    data: { userId, categoryId: category.id, topic },
    select: { id: true, topic: true, status: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, suggestion });
}
