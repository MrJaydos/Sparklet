import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { updateStreakOnActivity } from "@/lib/streak";
import { enterReviewSchedule, recordReview, isLongDwell } from "@/lib/sm2";
import { awardXp, getXpToday, DAILY_GOAL_XP } from "@/lib/xp";

const bodySchema = z.object({
  cardId: z.string().min(1),
  action: z.enum(["view"]),
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
  const { cardId, tzOffsetMinutes, dwellMs } = parsed.data;
  const tz = tzOffsetMinutes ?? 0;

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, body: true },
  });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  const existing = await prisma.userCardInteraction.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { id: true },
  });
  await prisma.userCardInteraction.upsert({
    where: { userId_cardId: { userId, cardId } },
    // Re-views bump viewedAt so profile history reflects recency.
    update: { completed: true, viewedAt: new Date() },
    create: { userId, cardId, completed: true },
  });

  // Spaced repetition: viewing a due review counts as a successful recall;
  // an unusually long dwell on a new card enters it into the schedule.
  let reviewRecalled = false;
  const srState = await prisma.spacedRepetitionState.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { nextReviewAt: true },
  });
  if (srState && srState.nextReviewAt.getTime() <= Date.now()) {
    await recordReview(userId, cardId, 4);
    reviewRecalled = true;
  } else if (!srState && dwellMs !== undefined && isLongDwell(dwellMs, card.body)) {
    await enterReviewSchedule(userId, cardId);
  }

  // XP: first read of a card earns 1, recalling a due review earns 5.
  // Dwell-only follow-up posts (same card) award nothing new.
  const xp = reviewRecalled
    ? await awardXp(userId, 5, "review", tz)
    : !existing
      ? await awardXp(userId, 1, "read", tz)
      : { awarded: 0, today: await getXpToday(userId, tz), total: 0, goal: DAILY_GOAL_XP };

  const streak = await updateStreakOnActivity(userId, tz);
  return NextResponse.json({ ok: true, streak, xp });
}
