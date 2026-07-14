import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { enterReviewSchedule, recordReview } from "@/lib/sm2";
import { awardXp, getAnswerCombo, comboMultiplier, getXpToday, DAILY_GOAL_XP } from "@/lib/xp";

const bodySchema = z.object({
  index: z.number().int().min(0).max(7),
  tzOffsetMinutes: z.number().int().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const quiz = await prisma.quizCard.findUnique({
    where: { id },
    select: { id: true, cardId: true, correctIndex: true, explanation: true, options: true },
  });
  if (!quiz) return NextResponse.json({ error: "quiz not found" }, { status: 404 });

  const correct = parsed.data.index === quiz.correctIndex;
  const tz = parsed.data.tzOffsetMinutes ?? 0;

  const prior = await prisma.userQuizAttempt.findUnique({
    where: { userId_quizCardId: { userId, quizCardId: quiz.id } },
    select: { id: true },
  });
  await prisma.userQuizAttempt.upsert({
    where: { userId_quizCardId: { userId, quizCardId: quiz.id } },
    update: {}, // first answer stands — retries don't overwrite
    create: { userId, quizCardId: quiz.id, correct },
  });

  // XP with combo bonus (first attempt only): consecutive correct answers
  // today multiply the award — worth chasing, not worth grinding retries.
  const combo = correct ? await getAnswerCombo(userId, tz) : 0;
  const multiplier = comboMultiplier(combo);
  const xp = prior
    ? { awarded: 0, today: await getXpToday(userId, tz), total: 0, goal: DAILY_GOAL_XP }
    : await awardXp(userId, (correct ? 10 : 2) * multiplier, "quiz", tz);

  // Feed the result into spaced repetition on the source card: correct
  // recall pushes the review out, a miss pulls it closer (or schedules it).
  const srState = await prisma.spacedRepetitionState.findUnique({
    where: { userId_cardId: { userId, cardId: quiz.cardId } },
    select: { id: true },
  });
  if (srState) {
    await recordReview(userId, quiz.cardId, correct ? 5 : 2);
  } else if (!correct) {
    await enterReviewSchedule(userId, quiz.cardId);
  }

  return NextResponse.json({
    correct,
    correctIndex: quiz.correctIndex,
    explanation: quiz.explanation,
    sourceCardId: quiz.cardId,
    xp,
    combo,
    multiplier,
  });
}
