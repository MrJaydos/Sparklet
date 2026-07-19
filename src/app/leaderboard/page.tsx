import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/display";
import { localDayStart } from "@/lib/xp";

export const metadata = { title: "Leaderboard — Sparklet" };
export const dynamic = "force-dynamic";

const BOARDS = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "all", label: "All time" },
  { key: "friends", label: "Friends" },
] as const;
type BoardKey = (typeof BOARDS)[number]["key"];

const TOP_N = 20;

type Row = { userId: string; name: string; xp: number };

/** Top XP earners since `since`, resolved to display names. */
async function xpBoard(since: Date): Promise<Row[]> {
  const sums = await prisma.xpEvent.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: TOP_N,
  });
  if (sums.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: sums.map((s) => s.userId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return sums.map((s) => {
    const u = byId.get(s.userId);
    return {
      userId: s.userId,
      name: u ? displayName(u) : "learner",
      xp: s._sum.amount ?? 0,
    };
  });
}

/** The viewer's own XP and competition rank (1 + number of strictly-better users). */
async function myWindowRank(userId: string, since: Date): Promise<{ xp: number; rank: number } | null> {
  const mine = await prisma.xpEvent.aggregate({
    where: { userId, createdAt: { gte: since } },
    _sum: { amount: true },
  });
  const xp = mine._sum.amount ?? 0;
  if (xp === 0) return null;
  const better = await prisma.xpEvent.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    having: { amount: { _sum: { gt: xp } } },
  });
  return { xp, rank: better.length + 1 };
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const { board: boardParam } = await searchParams;
  const board: BoardKey = BOARDS.some((b) => b.key === boardParam)
    ? (boardParam as BoardKey)
    : "today";

  const tzRaw = Number((await cookies()).get("sparklet.tz")?.value);
  const tz = Number.isFinite(tzRaw) ? tzRaw : 0;
  const dayStart = localDayStart(tz);
  const weekStart = new Date(dayStart.getTime() - 6 * 86_400_000);

  const self = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true, xp: true },
  });

  let rows: Row[];
  let me: { xp: number; rank: number } | null;
  if (board === "all") {
    const users = await prisma.user.findMany({
      where: { xp: { gt: 0 } },
      orderBy: { xp: "desc" },
      take: TOP_N,
      select: { id: true, name: true, email: true, xp: true },
    });
    rows = users.map((u) => ({ userId: u.id, name: displayName(u), xp: u.xp }));
    me =
      self.xp > 0
        ? { xp: self.xp, rank: (await prisma.user.count({ where: { xp: { gt: self.xp } } })) + 1 }
        : null;
  } else if (board === "friends") {
    const friendships = await prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
    const candidateIds = [...friendIds, userId];
    const users = await prisma.user.findMany({
      where: { id: { in: candidateIds }, xp: { gt: 0 } },
      orderBy: { xp: "desc" },
      take: TOP_N,
      select: { id: true, name: true, email: true, xp: true },
    });
    rows = users.map((u) => ({ userId: u.id, name: displayName(u), xp: u.xp }));
    me =
      self.xp > 0
        ? {
            xp: self.xp,
            rank:
              (await prisma.user.count({ where: { id: { in: candidateIds }, xp: { gt: self.xp } } })) + 1,
          }
        : null;
  } else {
    const since = board === "today" ? dayStart : weekStart;
    [rows, me] = await Promise.all([xpBoard(since), myWindowRank(userId, since)]);
  }

  const medals = ["🥇", "🥈", "🥉"];
  const inTop = rows.some((r) => r.userId === userId);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex items-center justify-between">
        <Link href="/feed" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to feed
        </Link>
      </div>

      <h1 className="mt-6 text-2xl font-bold">🏆 Leaderboard</h1>
      <p className="mt-1 text-sm text-neutral-500">
        XP from reading cards, quizzes, guesses and reviews.
      </p>

      <div className="mt-4 flex gap-2">
        {BOARDS.map((b) => (
          <Link
            key={b.key}
            href={b.key === "today" ? "/leaderboard" : `/leaderboard?board=${b.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              board === b.key
                ? "bg-violet-600 text-white"
                : "border border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            }`}
          >
            {b.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">
          {board === "friends" ? (
            <>
              No friends on the board yet — add some from your{" "}
              <Link href="/profile" className="underline hover:text-neutral-300">
                profile
              </Link>
              .
            </>
          ) : (
            <>
              Nobody has earned XP{board === "today" ? " today" : board === "week" ? " this week" : ""}{" "}
              yet — the first card you read puts you on the board.
            </>
          )}
        </p>
      ) : (
        <ol className="mt-5 space-y-1.5">
          {rows.map((r, i) => (
            <li
              key={r.userId}
              className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${
                r.userId === userId
                  ? "border-violet-600/60 bg-violet-600/10"
                  : "border-neutral-800 bg-neutral-900"
              }`}
            >
              <span className="w-7 shrink-0 text-center text-sm tabular-nums text-neutral-400">
                {medals[i] ?? i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
                {r.name}
                {r.userId === userId && <span className="ml-1.5 text-xs text-violet-400">you</span>}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-amber-300">
                ⚡ {r.xp.toLocaleString("en")}
              </span>
            </li>
          ))}
        </ol>
      )}

      {me && !inTop && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-violet-600/60 bg-violet-600/10 px-4 py-2.5">
          <span className="w-7 shrink-0 text-center text-sm tabular-nums text-neutral-400">
            {me.rank}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
            {displayName(self)}
            <span className="ml-1.5 text-xs text-violet-400">you</span>
          </span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-amber-300">
            ⚡ {me.xp.toLocaleString("en")}
          </span>
        </div>
      )}
    </main>
  );
}
