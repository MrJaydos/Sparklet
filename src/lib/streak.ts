import { prisma } from "@/lib/db";

/**
 * Streak counts calendar days (in the user's local timezone) with at least
 * one card viewed. `tzOffsetMinutes` is `new Date().getTimezoneOffset()`
 * from the client (UTC = local + offset).
 *
 * Streak freezes: refilled to 2 at the first activity of each calendar
 * month. Each freeze covers one missed day; if the gap since the last
 * active day can be fully covered by available freezes, the streak
 * continues instead of resetting. Surfaced plainly in the UI — never hidden.
 */
export async function updateStreakOnActivity(
  userId: string,
  tzOffsetMinutes: number
): Promise<{
  currentStreak: number;
  longestStreak: number;
  freezesUsed: number;
  freezesAvailable: number;
}> {
  const offset = Number.isFinite(tzOffsetMinutes)
    ? Math.max(-840, Math.min(840, tzOffsetMinutes))
    : 0;

  // The user's local calendar date, normalized to UTC midnight for storage.
  const localNow = new Date(Date.now() - offset * 60_000);
  const today = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate())
  );
  const monthStart = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 1));

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      currentStreak: true,
      longestStreak: true,
      lastActiveDate: true,
      streakFreezesAvailable: true,
      freezesRefilledAt: true,
    },
  });

  // Monthly freeze refill (top up to 2, never stack beyond it).
  let freezesAvailable = user.streakFreezesAvailable;
  let freezesRefilledAt = user.freezesRefilledAt;
  if (!freezesRefilledAt || freezesRefilledAt.getTime() < monthStart.getTime()) {
    freezesAvailable = Math.max(freezesAvailable, 2);
    freezesRefilledAt = monthStart;
  }

  if (user.lastActiveDate?.getTime() === today.getTime()) {
    if (
      freezesAvailable !== user.streakFreezesAvailable ||
      freezesRefilledAt?.getTime() !== user.freezesRefilledAt?.getTime()
    ) {
      await prisma.user.update({
        where: { id: userId },
        data: { streakFreezesAvailable: freezesAvailable, freezesRefilledAt },
      });
    }
    return {
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      freezesUsed: 0,
      freezesAvailable,
    };
  }

  const dayMs = 86_400_000;
  const gapDays = user.lastActiveDate
    ? Math.round((today.getTime() - user.lastActiveDate.getTime()) / dayMs)
    : Infinity;
  const missedDays = Number.isFinite(gapDays) ? Math.max(0, gapDays - 1) : Infinity;

  let currentStreak: number;
  let freezesUsed = 0;
  if (missedDays === 0) {
    currentStreak = user.currentStreak + 1;
  } else if (missedDays <= freezesAvailable) {
    // Freezes cover the gap — streak continues.
    freezesUsed = missedDays as number;
    freezesAvailable -= freezesUsed;
    currentStreak = user.currentStreak + 1;
  } else {
    currentStreak = 1;
  }
  const longestStreak = Math.max(currentStreak, user.longestStreak);

  await prisma.user.update({
    where: { id: userId },
    data: {
      currentStreak,
      longestStreak,
      lastActiveDate: today,
      streakFreezesAvailable: freezesAvailable,
      freezesRefilledAt,
      // Remembered so the nudge cron can reason about this user's local
      // time (evening reminders, "active today" checks).
      tzOffsetMinutes: offset,
    },
  });
  return { currentStreak, longestStreak, freezesUsed, freezesAvailable };
}
