import { prisma } from "@/lib/db";

/**
 * Streak counts calendar days (in the user's local timezone) with at least
 * one card viewed. `tzOffsetMinutes` is `new Date().getTimezoneOffset()`
 * from the client (UTC = local + offset).
 */
export async function updateStreakOnActivity(
  userId: string,
  tzOffsetMinutes: number
): Promise<{ currentStreak: number; longestStreak: number }> {
  const offset = Number.isFinite(tzOffsetMinutes)
    ? Math.max(-840, Math.min(840, tzOffsetMinutes))
    : 0;

  // The user's local calendar date, normalized to UTC midnight for storage.
  const localNow = new Date(Date.now() - offset * 60_000);
  const today = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate())
  );

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { currentStreak: true, longestStreak: true, lastActiveDate: true },
  });

  if (user.lastActiveDate?.getTime() === today.getTime()) {
    return { currentStreak: user.currentStreak, longestStreak: user.longestStreak };
  }

  const yesterday = new Date(today.getTime() - 86_400_000);
  const currentStreak =
    user.lastActiveDate?.getTime() === yesterday.getTime() ? user.currentStreak + 1 : 1;
  const longestStreak = Math.max(currentStreak, user.longestStreak);

  await prisma.user.update({
    where: { id: userId },
    data: { currentStreak, longestStreak, lastActiveDate: today },
  });
  return { currentStreak, longestStreak };
}
