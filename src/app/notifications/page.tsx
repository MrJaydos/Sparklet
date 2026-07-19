import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { getXpToday, DAILY_GOAL_XP } from "@/lib/xp";
import { getAdminAlerts } from "@/lib/notifications";
import { AppHeader } from "@/components/AppHeader";

export const metadata = { title: "Notifications — Sparklet" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const isAdmin = isAdminEmail(session.user.email);

  const tzRaw = Number((await cookies()).get("sparklet.tz")?.value);
  const tz = Number.isFinite(tzRaw) ? tzRaw : 0;

  const [notifications, user, xpToday, adminAlerts] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        card: { select: { id: true, title: true } },
        comment: { select: { body: true } },
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, streakFreezesAvailable: true },
    }),
    getXpToday(userId, tz),
    isAdmin ? getAdminAlerts() : Promise.resolve([]),
  ]);

  // Viewing the page marks everything read (admin alerts aren't real rows —
  // they clear themselves once the underlying reports/review queue empties).
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <AppHeader
        streak={user.currentStreak}
        longestStreak={user.longestStreak}
        freezesAvailable={user.streakFreezesAvailable}
        xpToday={xpToday}
        dailyGoal={DAILY_GOAL_XP}
        unread={adminAlerts.reduce((sum, a) => sum + a.count, 0)}
        inviteUrl={`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/invite/${userId}`}
        isAdmin={isAdmin}
        signOutAction={signOutAction}
      />
      <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+4rem)]">
      <h1 className="mt-6 text-2xl font-bold">Notifications</h1>

      {adminAlerts.length > 0 && (
        <ul className="mt-4 space-y-2">
          {adminAlerts.map((a) => (
            <li key={a.id}>
              <Link
                href="/admin"
                className="block rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-200 transition hover:border-amber-500"
              >
                🛠️ {a.label}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {notifications.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          When someone replies in a comment thread you&apos;re part of, it shows up here.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {notifications.map((n) => (
            <li key={n.id}>
              <Link
                href={`/card/${n.card.id}`}
                className={`block rounded-xl border p-4 transition hover:border-neutral-600 ${
                  n.readAt === null
                    ? "border-violet-800 bg-violet-950/30"
                    : "border-neutral-800 bg-neutral-900"
                }`}
              >
                <div className="text-sm">
                  <span className="font-semibold">{n.actorName}</span>{" "}
                  <span className="text-neutral-400">commented on</span>{" "}
                  <span className="font-medium">{n.card.title}</span>
                </div>
                {n.comment && (
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                    “{n.comment.body}”
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      </main>
    </>
  );
}
