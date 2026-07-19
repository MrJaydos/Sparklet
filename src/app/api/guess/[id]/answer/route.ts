import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  awardXp,
  getAnswerCombo,
  comboMultiplier,
  getXpToday,
  DAILY_GOAL_XP,
  GUESS_CORRECT_THRESHOLD,
} from "@/lib/xp";

const bodySchema = z.object({
  guess: z.number().finite(),
  tzOffsetMinutes: z.number().int().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const tz = parsed.data.tzOffsetMinutes ?? 0;

  const guessCard = await prisma.guessCard.findUnique({
    where: { id },
    select: { id: true, cardId: true, answer: true, min: true, max: true, explanation: true },
  });
  if (!guessCard) return NextResponse.json({ error: "guess not found" }, { status: 404 });

  const guess = Math.max(guessCard.min, Math.min(guessCard.max, parsed.data.guess));
  const range = Math.max(1e-9, guessCard.max - guessCard.min);
  const accuracy = Math.max(0, Math.min(1, 1 - Math.abs(guess - guessCard.answer) / range));
  const correct = accuracy >= GUESS_CORRECT_THRESHOLD;

  // Guests get the reveal — the actual learning moment — but nothing is
  // saved or awarded (no account to save it to).
  if (!userId) {
    return NextResponse.json({
      answer: guessCard.answer,
      accuracy,
      correct,
      explanation: guessCard.explanation,
      sourceCardId: guessCard.cardId,
      xp: { awarded: 0, today: 0, total: 0, goal: DAILY_GOAL_XP },
      combo: 0,
      multiplier: 1,
      guest: true,
    });
  }

  const prior = await prisma.userGuessAttempt.findUnique({
    where: { userId_guessCardId: { userId, guessCardId: guessCard.id } },
    select: { id: true },
  });
  await prisma.userGuessAttempt.upsert({
    where: { userId_guessCardId: { userId, guessCardId: guessCard.id } },
    update: {}, // first guess stands
    create: { userId, guessCardId: guessCard.id, guess, accuracy },
  });

  // Closeness scales the award (2–10); a near-perfect guess also extends
  // the answer combo and earns its multiplier.
  const combo = correct ? await getAnswerCombo(userId, tz) : 0;
  const multiplier = comboMultiplier(combo);
  const xp = prior
    ? { awarded: 0, today: await getXpToday(userId, tz), total: 0, goal: DAILY_GOAL_XP }
    : await awardXp(userId, (2 + 8 * accuracy) * multiplier, "guess", tz);

  return NextResponse.json({
    answer: guessCard.answer,
    accuracy,
    correct,
    explanation: guessCard.explanation,
    sourceCardId: guessCard.cardId,
    xp,
    combo,
    multiplier,
  });
}
