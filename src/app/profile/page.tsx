import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { displayName } from "@/lib/display";
import { computeBadges } from "@/lib/badges";
import { PushToggle } from "@/components/PushToggle";
import { FriendsPanel, type FriendRow } from "@/components/FriendsPanel";

export const metadata = { title: "Profile — Sparklet" };
export const dynamic = "force-dynamic";

function formatWhen(d: Date) {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [
    user,
    totalViewed,
    { top: topCategories, total: categoriesExplored },
    history,
    savedCards,
    dueReviews,
    quizzesCorrect,
    guessesAnswered,
    friendships,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        currentStreak: true,
        longestStreak: true,
        streakFreezesAvailable: true,
        xp: true,
      },
    }),
    prisma.userCardInteraction.count({ where: { userId, completed: true } }),
    prisma.userCardInteraction.groupBy({
      by: ["cardId"],
      where: { userId, completed: true },
      _count: true,
    }).then(async (rows) => {
      if (rows.length === 0) return { top: [], total: 0 };
      const cards = await prisma.card.findMany({
        where: { id: { in: rows.map((r) => r.cardId) } },
        select: { category: { select: { name: true, icon: true, colorHex: true } } },
      });
      const counts = new Map<string, { name: string; icon: string; colorHex: string; count: number }>();
      for (const c of cards) {
        const cur = counts.get(c.category.name) ?? { ...c.category, count: 0 };
        cur.count++;
        counts.set(c.category.name, cur);
      }
      const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
      return { top: sorted.slice(0, 5), total: sorted.length };
    }),
    prisma.userCardInteraction.findMany({
      where: { userId, completed: true },
      orderBy: { viewedAt: "desc" },
      take: 50,
      select: {
        viewedAt: true,
        card: {
          select: {
            id: true,
            title: true,
            category: { select: { name: true, icon: true, colorHex: true } },
          },
        },
      },
    }),
    prisma.savedCard.findMany({
      where: { userId },
      orderBy: { savedAt: "desc" },
      take: 100,
      select: {
        card: {
          select: {
            id: true,
            title: true,
            category: { select: { name: true, icon: true, colorHex: true } },
          },
        },
      },
    }),
    prisma.spacedRepetitionState.count({
      where: { userId, nextReviewAt: { lte: new Date() } },
    }),
    prisma.userQuizAttempt.count({ where: { userId, correct: true } }),
    prisma.userGuessAttempt.count({ where: { userId } }),
    prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: {
        id: true,
        status: true,
        requesterId: true,
        requester: { select: { name: true, email: true } },
        addressee: { select: { name: true, email: true } },
      },
    }),
  ]);

  const friends: FriendRow[] = [];
  const incoming: FriendRow[] = [];
  const outgoing: FriendRow[] = [];
  for (const f of friendships) {
    const mine = f.requesterId === userId;
    const other = mine ? f.addressee : f.requester;
    const row: FriendRow = { friendshipId: f.id, name: displayName(other), email: other.email };
    if (f.status === "ACCEPTED") friends.push(row);
    else if (mine) outgoing.push(row);
    else incoming.push(row);
  }

  const badges = computeBadges({
    cards: totalViewed,
    streak: user.longestStreak,
    quiz: quizzesCorrect,
    categories: categoriesExplored,
    notebook: savedCards.length,
    guess: guessesAnswered,
  });

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  async function updateNameAction(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user?.id) return;
    const name = String(formData.get("name") ?? "").trim().slice(0, 40);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { name: name || null },
    });
    revalidatePath("/profile");
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+2rem)]">
      <div className="flex items-center justify-between">
        <Link href="/feed" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to feed
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/leaderboard" className="text-sm text-neutral-400 hover:text-neutral-200">
            🏆 Leaderboard
          </Link>
          {isAdminEmail(user.email) && (
            <Link href="/admin" className="text-sm text-neutral-400 hover:text-neutral-200">
              🛠️ Admin
            </Link>
          )}
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-neutral-400 hover:text-neutral-200">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <h1 className="mt-6 text-2xl font-bold">{displayName(user)}</h1>
      <p className="mt-1 text-sm text-neutral-500">{user.email}</p>

      <form action={updateNameAction} className="mt-3 flex gap-2">
        <input
          type="text"
          name="name"
          defaultValue={user.name ?? ""}
          maxLength={40}
          placeholder="Set a display name"
          className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-white"
        >
          Save
        </button>
      </form>

      <div className="mt-6 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-3xl font-bold">{totalViewed}</div>
          <div className="mt-1 text-xs text-neutral-400">cards learned</div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="whitespace-nowrap text-3xl font-bold text-amber-300">
            <span className="mr-0.5 align-middle text-xl">⚡</span>
            {user.xp.toLocaleString("en")}
          </div>
          <div className="mt-1 text-xs text-neutral-400">lifetime XP</div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="whitespace-nowrap text-3xl font-bold">
            <span className="mr-0.5 align-middle text-xl">🔥</span>
            {user.currentStreak}
          </div>
          <div className="mt-1 text-xs text-neutral-400">day streak</div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-3xl font-bold">{user.longestStreak}</div>
          <div className="mt-1 text-xs text-neutral-400">longest streak</div>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-neutral-500">
        🧊 {user.streakFreezesAvailable} streak freeze{user.streakFreezesAvailable === 1 ? "" : "s"}{" "}
        available — a freeze automatically covers a missed day. Refills to 2 each month.
        {dueReviews > 0 && (
          <>
            {" "}
            · 🔁 {dueReviews} card{dueReviews === 1 ? "" : "s"} due for review in your feed
          </>
        )}
      </p>

      <h2 className="mt-8 text-lg font-bold">Badges</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {badges.map((b) => (
          <div
            key={b.key}
            className={`rounded-2xl border p-3 text-center ${
              b.earnedTier
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-neutral-800 bg-neutral-900"
            }`}
          >
            <div className={`text-2xl ${b.earnedTier ? "" : "opacity-30 grayscale"}`}>{b.icon}</div>
            <div
              className={`mt-1 text-xs font-semibold ${
                b.earnedTier ? "text-amber-300" : "text-neutral-500"
              }`}
            >
              {b.earnedTier ? b.earnedTier.label : b.name}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-500">
              {b.nextTier ? `${b.value}/${b.nextTier.threshold}` : "maxed"}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-bold">Friends</h2>
      <FriendsPanel friends={friends} incoming={incoming} outgoing={outgoing} />

      <PushToggle />

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-bold">Notebook</h2>
        {savedCards.length > 0 && (
          <a
            href="/api/notebook/export"
            className="text-sm text-neutral-400 underline hover:text-neutral-200"
          >
            Export as markdown
          </a>
        )}
      </div>
      {savedCards.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          Tap 📑 on a card to save it to your notebook — your deliberate keep-list.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {savedCards.map(({ card }) => (
            <li key={card.id}>
              <Link
                href={`/card/${card.id}`}
                className="flex items-baseline gap-2 rounded-lg border border-transparent px-3 py-2 transition hover:border-neutral-700 hover:bg-neutral-900"
              >
                <span className="text-xs" style={{ color: card.category.colorHex }}>
                  {card.category.icon}
                </span>
                <span className="text-sm text-neutral-200">{card.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {topCategories.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Top topics</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {topCategories.map((c) => (
              <span
                key={c.name}
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{ backgroundColor: `${c.colorHex}26`, color: c.colorHex }}
              >
                {c.icon} {c.name} · {c.count}
              </span>
            ))}
          </div>
        </>
      )}

      <h2 className="mt-8 text-lg font-bold">History</h2>
      {history.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          Every card you view ends up here, so nothing is ever lost to a scroll
          or a refresh.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {history.map(({ card, viewedAt }) => (
            <li key={card.id}>
              <Link
                href={`/card/${card.id}`}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition hover:border-neutral-700 hover:bg-neutral-900"
              >
                <span className="min-w-0">
                  <span className="text-xs" style={{ color: card.category.colorHex }}>
                    {card.category.icon}
                  </span>{" "}
                  <span className="text-sm text-neutral-200">{card.title}</span>
                </span>
                <span className="shrink-0 text-xs text-neutral-600">
                  {formatWhen(viewedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

    </main>
  );
}
