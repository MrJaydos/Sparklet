import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { enterReviewSchedule, recordReview } from "@/lib/sm2";
import { awardXp, getXpToday, isXpRateLimited, DAILY_GOAL_XP } from "@/lib/xp";
import { gradeExplanation } from "@/lib/grade-explanation";

const bodySchema = z.object({
  text: z.string().min(10).max(600),
  tzOffsetMinutes: z.number().int().optional(),
});

// Cost control, not just anti-farming — every award here is gated behind a
// paid LLM call, unlike read XP which is free to award.
const EXPLAIN_XP_PER_MINUTE = 5;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  // No guest grading — each attempt costs a real LLM call.
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { cardId } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const tz = parsed.data.tzOffsetMinutes ?? 0;

  // Prior check BEFORE any paid call — a resubmit must return the stored
  // grade, never re-grade (unlike quiz/guess, cost is the concern here, not
  // just gameable XP).
  const prior = await prisma.userExplanationAttempt.findUnique({
    where: { userId_cardId: { userId, cardId } },
  });
  if (prior) {
    return NextResponse.json({
      score: prior.score,
      feedback: prior.feedback,
      xp: { awarded: 0, today: await getXpToday(userId, tz), total: 0, goal: DAILY_GOAL_XP },
    });
  }

  if (await isXpRateLimited(userId, "explain", EXPLAIN_XP_PER_MINUTE, 60_000)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { title: true, body: true },
  });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  let graded;
  try {
    graded = await gradeExplanation(card, parsed.data.text);
  } catch {
    return NextResponse.json({ error: "generation failed" }, { status: 502 });
  }

  await prisma.userExplanationAttempt.create({
    data: {
      userId,
      cardId,
      explanation: parsed.data.text,
      score: graded.score,
      feedback: graded.feedback,
    },
  });

  // Continuous version of quiz's correct/wrong -> 5/2 quality mapping.
  const quality = Math.max(0, Math.min(5, Math.round(graded.score * 5))) as 0 | 1 | 2 | 3 | 4 | 5;
  const srState = await prisma.spacedRepetitionState.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { id: true },
  });
  if (srState) {
    await recordReview(userId, cardId, quality);
  } else if (quality < 3) {
    await enterReviewSchedule(userId, cardId);
  }

  // Same 2-10 reward shape as guess's closeness scaling.
  const xp = await awardXp(userId, Math.round(2 + 8 * graded.score), "explain", tz);

  return NextResponse.json({ score: graded.score, feedback: graded.feedback, xp });
}
