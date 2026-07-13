import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { enterReviewSchedule, recordReview } from "@/lib/sm2";

const bodySchema = z.object({ index: z.number().int().min(0).max(7) });

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

  await prisma.userQuizAttempt.upsert({
    where: { userId_quizCardId: { userId, quizCardId: quiz.id } },
    update: {}, // first answer stands — retries don't overwrite
    create: { userId, quizCardId: quiz.id, correct },
  });

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
  });
}
