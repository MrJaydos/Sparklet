import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { updateStreakOnActivity } from "@/lib/streak";
import { enterReviewSchedule, recordReview, isLongDwell } from "@/lib/sm2";

const bodySchema = z.object({
  cardId: z.string().min(1),
  action: z.enum(["view", "like", "unlike"]),
  tzOffsetMinutes: z.number().int().optional(),
  dwellMs: z.number().int().min(0).max(3_600_000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { cardId, action, tzOffsetMinutes, dwellMs } = parsed.data;

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, body: true },
  });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  if (action === "view") {
    await prisma.userCardInteraction.upsert({
      where: { userId_cardId: { userId, cardId } },
      // Re-views bump viewedAt so profile history reflects recency.
      update: { completed: true, viewedAt: new Date() },
      create: { userId, cardId, completed: true },
    });

    // Spaced repetition: viewing a due review counts as a successful recall;
    // an unusually long dwell on a new card enters it into the schedule.
    const srState = await prisma.spacedRepetitionState.findUnique({
      where: { userId_cardId: { userId, cardId } },
      select: { nextReviewAt: true },
    });
    if (srState && srState.nextReviewAt.getTime() <= Date.now()) {
      await recordReview(userId, cardId, 4);
    } else if (!srState && dwellMs !== undefined && isLongDwell(dwellMs, card.body)) {
      await enterReviewSchedule(userId, cardId);
    }

    const streak = await updateStreakOnActivity(userId, tzOffsetMinutes ?? 0);
    return NextResponse.json({ ok: true, streak });
  }

  const liked = action === "like";
  await prisma.userCardInteraction.upsert({
    where: { userId_cardId: { userId, cardId } },
    update: { liked },
    create: { userId, cardId, liked },
  });
  // Liking a card is a deliberate "this matters to me" — schedule it.
  if (liked) await enterReviewSchedule(userId, cardId);
  return NextResponse.json({ ok: true, liked });
}
