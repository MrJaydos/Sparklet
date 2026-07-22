import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recordReview } from "@/lib/sm2";
import { awardXp, DAILY_GOAL_XP } from "@/lib/xp";

const bodySchema = z.object({
  index: z.number().int().min(0).max(7),
  tzOffsetMinutes: z.number().int().optional(),
});

// Answers a due spaced-repetition review rendered as a question (see
// src/lib/feed.ts's `reviewQuizzes`). Unlike /api/quiz/[id]/answer, this
// pays XP every time it's answered — a review recurs by design, so it isn't
// gated by UserQuizAttempt's once-only "first answer stands" semantics.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
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

  // Guests get the answer check and explanation, nothing saved or awarded.
  if (!userId) {
    return NextResponse.json({
      correct,
      correctIndex: quiz.correctIndex,
      explanation: quiz.explanation,
      xp: { awarded: 0, today: 0, total: 0, goal: DAILY_GOAL_XP },
      combo: 0,
      multiplier: 1,
      guest: true,
    });
  }

  // The card must actually be due — client-claimed review state is never
  // trusted. This also doubles as replay protection: recordReview always
  // pushes nextReviewAt at least a day out, so a second POST for the same
  // due instance will fail this check.
  const srState = await prisma.spacedRepetitionState.findUnique({
    where: { userId_cardId: { userId, cardId: quiz.cardId } },
    select: { nextReviewAt: true },
  });
  if (!srState || srState.nextReviewAt.getTime() > Date.now()) {
    return NextResponse.json({ error: "not due" }, { status: 409 });
  }

  const xp = await awardXp(userId, correct ? 5 : 2, "review", tz);
  await recordReview(userId, quiz.cardId, correct ? 5 : 2);

  return NextResponse.json({
    correct,
    correctIndex: quiz.correctIndex,
    explanation: quiz.explanation,
    xp,
    combo: 0,
    multiplier: 1,
  });
}
