import { prisma } from "@/lib/db";

/**
 * XP: small, immediate rewards for learning actions, summed into a daily
 * goal (the header ring). One XpEvent row per award keeps daily totals and
 * future recaps/leagues queryable; User.xp is the denormalized lifetime sum.
 *
 * Base amounts:
 *   read a new card       1
 *   due review recalled   5
 *   quiz answered         10 correct / 2 wrong
 *   guess locked in       2–10, scaling with closeness
 *
 * Combos: consecutive correct quiz/guess answers today multiply quiz and
 * guess XP — ×1.5 from a 3-streak, ×2 from 5, ×3 from 10.
 */

export const DAILY_GOAL_XP = 50;

// A guess this close (as a fraction of the slider range) counts as "correct"
// for combo purposes and gets the full-marks message.
export const GUESS_CORRECT_THRESHOLD = 0.85;

export type XpSummary = {
  awarded: number; // this action's XP (0 when nothing was awarded)
  today: number; // total XP earned in the user's local day
  total: number; // lifetime XP
  goal: number;
};

/** UTC instant where the user's local calendar day started (streak.ts convention). */
export function localDayStart(tzOffsetMinutes: number): Date {
  const offset = Number.isFinite(tzOffsetMinutes)
    ? Math.max(-840, Math.min(840, tzOffsetMinutes))
    : 0;
  const localNow = new Date(Date.now() - offset * 60_000);
  return new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) +
      offset * 60_000
  );
}

export async function getXpToday(userId: string, tzOffsetMinutes: number): Promise<number> {
  const sum = await prisma.xpEvent.aggregate({
    where: { userId, createdAt: { gte: localDayStart(tzOffsetMinutes) } },
    _sum: { amount: true },
  });
  return sum._sum.amount ?? 0;
}

// "Things learned today" for the card-count goal: one XpEvent row is
// created per completed card (read, review recall, quiz, guess), so this
// is a count over the same window getXpToday sums.
export async function getCardsToday(userId: string, tzOffsetMinutes: number): Promise<number> {
  return prisma.xpEvent.count({
    where: { userId, createdAt: { gte: localDayStart(tzOffsetMinutes) } },
  });
}

// Ceiling on read-XP awards per rolling minute. A real reader tops out
// around 11/min (the client's read ping needs ~5s of dwell per card), so
// legit users never touch this; parallel-request farming does.
export const READ_XP_PER_MINUTE = 15;

/** Generic per-kind rolling-window rate limiter. `isReadXpRateLimited` is the
 * original bespoke case; other kinds (e.g. "explain", which costs a paid LLM
 * call) reuse this directly as a real cost control, not just anti-farming. */
export async function isXpRateLimited(
  userId: string,
  kind: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const recent = await prisma.xpEvent.count({
    where: { userId, kind, createdAt: { gte: new Date(Date.now() - windowMs) } },
  });
  return recent >= limit;
}

export function isReadXpRateLimited(userId: string): Promise<boolean> {
  return isXpRateLimited(userId, "read", READ_XP_PER_MINUTE, 60_000);
}

export async function awardXp(
  userId: string,
  amount: number,
  kind: "read" | "review" | "quiz" | "guess" | "misconception" | "explain",
  tzOffsetMinutes: number
): Promise<XpSummary> {
  const rounded = Math.max(0, Math.round(amount));
  const [user] = await Promise.all([
    prisma.user.update({
      where: { id: userId },
      data: { xp: { increment: rounded } },
      select: { xp: true },
    }),
    rounded > 0
      ? prisma.xpEvent.create({ data: { userId, amount: rounded, kind } })
      : Promise.resolve(null),
  ]);
  const today = await getXpToday(userId, tzOffsetMinutes);
  return { awarded: rounded, today, total: user.xp, goal: DAILY_GOAL_XP };
}

/**
 * Current answer combo: consecutive correct quiz/guess/misconception answers
 * today, most recent first — computed after the current attempt is
 * recorded, so the attempt that extends the streak sees its own contribution.
 */
export async function getAnswerCombo(userId: string, tzOffsetMinutes: number): Promise<number> {
  const since = localDayStart(tzOffsetMinutes);
  const [quiz, guess, misconception] = await Promise.all([
    prisma.userQuizAttempt.findMany({
      where: { userId, answeredAt: { gte: since } },
      orderBy: { answeredAt: "desc" },
      take: 30,
      select: { correct: true, answeredAt: true },
    }),
    prisma.userGuessAttempt.findMany({
      where: { userId, answeredAt: { gte: since } },
      orderBy: { answeredAt: "desc" },
      take: 30,
      select: { accuracy: true, answeredAt: true },
    }),
    prisma.userMisconceptionAttempt.findMany({
      where: { userId, answeredAt: { gte: since } },
      orderBy: { answeredAt: "desc" },
      take: 30,
      select: { correct: true, answeredAt: true },
    }),
  ]);
  const merged = [
    ...quiz.map((a) => ({ at: a.answeredAt.getTime(), correct: a.correct })),
    ...guess.map((a) => ({
      at: a.answeredAt.getTime(),
      correct: a.accuracy >= GUESS_CORRECT_THRESHOLD,
    })),
    ...misconception.map((a) => ({ at: a.answeredAt.getTime(), correct: a.correct })),
  ].sort((a, b) => b.at - a.at);

  let combo = 0;
  for (const a of merged) {
    if (!a.correct) break;
    combo++;
  }
  return combo;
}

/** ×1 below a 3-streak, ×1.5 from 3, ×2 from 5, ×3 from 10. */
export function comboMultiplier(combo: number): number {
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  if (combo >= 3) return 1.5;
  return 1;
}
