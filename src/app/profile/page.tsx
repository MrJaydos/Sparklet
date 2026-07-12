import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";

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

  const [user, totalViewed, topCategories, likedCards, history] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, currentStreak: true, longestStreak: true },
    }),
    prisma.userCardInteraction.count({ where: { userId, completed: true } }),
    prisma.userCardInteraction.groupBy({
      by: ["cardId"],
      where: { userId, completed: true },
      _count: true,
    }).then(async (rows) => {
      if (rows.length === 0) return [];
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
      return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    }),
    prisma.userCardInteraction.findMany({
      where: { userId, liked: true },
      orderBy: { viewedAt: "desc" },
      take: 50,
      select: {
        card: {
          select: {
            id: true,
            title: true,
            readMoreUrl: true,
            category: { select: { name: true, icon: true, colorHex: true } },
          },
        },
      },
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
  ]);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-8">
      <div className="flex items-center justify-between">
        <Link href="/feed" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to feed
        </Link>
        <div className="flex items-center gap-4">
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

      <h1 className="mt-6 text-2xl font-bold">Your learning</h1>
      <p className="mt-1 text-sm text-neutral-500">{user.email}</p>

      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-3xl font-bold">{totalViewed}</div>
          <div className="mt-1 text-xs text-neutral-400">cards learned</div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-3xl font-bold">🔥 {user.currentStreak}</div>
          <div className="mt-1 text-xs text-neutral-400">day streak</div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-3xl font-bold">{user.longestStreak}</div>
          <div className="mt-1 text-xs text-neutral-400">longest streak</div>
        </div>
      </div>

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

      <h2 className="mt-8 text-lg font-bold">Saved for later</h2>
      {likedCards.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          Cards you ❤️ in the feed show up here so you can come back to them.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {likedCards.map(({ card }) => (
            <li key={card.id}>
              <a
                href={card.readMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-600"
              >
                <div className="text-xs" style={{ color: card.category.colorHex }}>
                  {card.category.icon} {card.category.name}
                </div>
                <div className="mt-1 font-medium">{card.title}</div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
