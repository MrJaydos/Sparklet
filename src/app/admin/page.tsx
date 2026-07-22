import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { getXpToday, DAILY_GOAL_XP } from "@/lib/xp";
import { getUnreadCount } from "@/lib/notifications";
import { isBillingEnabled } from "@/lib/billing";
import { AppHeader } from "@/components/AppHeader";

export const metadata = { title: "Admin — Sparklet" };
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || !isAdminEmail(session.user.email)) redirect("/feed");
  return session;
}

// ---------- server actions ----------

async function resolveCardReports(formData: FormData) {
  "use server";
  await requireAdmin();
  const cardId = String(formData.get("cardId"));
  const action = String(formData.get("action")); // dismiss | unpublish | publish
  if (action === "unpublish") {
    await prisma.card.update({
      where: { id: cardId },
      data: { published: false, reviewNote: "Unpublished by admin after reports" },
    });
  } else if (action === "publish") {
    await prisma.card.update({
      where: { id: cardId },
      data: { published: true, reviewNote: null },
    });
  }
  await prisma.report.updateMany({
    where: { cardId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  revalidatePath("/admin");
}

async function resolveCommentReports(formData: FormData) {
  "use server";
  await requireAdmin();
  const commentId = String(formData.get("commentId"));
  const action = String(formData.get("action")); // dismiss | hide | unhide
  if (action === "hide") {
    await prisma.comment.update({ where: { id: commentId }, data: { hiddenAt: new Date() } });
  } else if (action === "unhide") {
    await prisma.comment.update({ where: { id: commentId }, data: { hiddenAt: null } });
  }
  await prisma.report.updateMany({
    where: { commentId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  revalidatePath("/admin");
}

async function reviewCard(formData: FormData) {
  "use server";
  await requireAdmin();
  const cardId = String(formData.get("cardId"));
  const action = String(formData.get("action")); // publish | delete
  if (action === "publish") {
    await prisma.card.update({
      where: { id: cardId },
      data: { published: true, reviewNote: null },
    });
  } else if (action === "delete") {
    await prisma.card.delete({ where: { id: cardId } });
  }
  revalidatePath("/admin");
}

// ---------- page ----------

const btn =
  "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "retention", label: "Retention" },
  { key: "challenges", label: "Challenges" },
  { key: "moderation", label: "Moderation" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function StatGrid({ tiles }: { tiles: [React.ReactNode, string][] }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
      {tiles.map(([n, label]) => (
        <div key={label} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-2xl font-bold">{n}</div>
          <div className="mt-1 text-xs text-neutral-400">{label}</div>
        </div>
      ))}
    </div>
  );
}

const pct = (num: number, denom: number) => (denom > 0 ? `${Math.round((num / denom) * 100)}%` : "—");

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireAdmin();
  if (!session.user?.id) redirect("/login");
  const adminUserId = session.user.id;

  const { tab: tabParam } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "overview";

  const tzRaw = Number((await cookies()).get("sparklet.tz")?.value);
  const tz = Number.isFinite(tzRaw) ? tzRaw : 0;

  const [adminUser, unread, xpToday, userCount, publishedCount, unpublished, openReports, commentCount] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: adminUserId },
        select: { currentStreak: true, longestStreak: true, streakFreezesAvailable: true },
      }),
      getUnreadCount(adminUserId, true),
      getXpToday(adminUserId, tz),
      prisma.user.count(),
      prisma.card.count({ where: { published: true, depthLevel: "STANDARD" } }),
      prisma.card.findMany({
        where: { published: false },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          reviewNote: true,
          modelUsed: true,
          category: { select: { name: true, icon: true } },
        },
      }),
      prisma.report.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          reporter: { select: { email: true } },
          card: { select: { id: true, title: true, published: true } },
          comment: {
            select: {
              id: true,
              body: true,
              hiddenAt: true,
              user: { select: { email: true } },
              card: { select: { id: true, title: true } },
            },
          },
        },
      }),
      prisma.comment.count(),
    ]);

  const [dau, wau, newUsers7d, views7d, savesCount, viewsByDay, categoryStats, topCards, worstCards] =
    await Promise.all([
      prisma.user.count({ where: { lastActiveDate: { gte: daysAgo(1) } } }),
      prisma.user.count({ where: { lastActiveDate: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      prisma.userCardInteraction.count({ where: { viewedAt: { gte: daysAgo(7) } } }),
      prisma.savedCard.count(),
      prisma.$queryRaw<{ day: Date; views: number }[]>`
      SELECT date_trunc('day', "viewedAt") AS day, count(*)::int AS views
      FROM "UserCardInteraction"
      WHERE "viewedAt" >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1
    `,
      prisma.$queryRaw<
        { name: string; icon: string; published: number; seen: number; views7d: number; score: number }[]
      >`
      SELECT cat.name, cat.icon,
        (SELECT count(*)::int FROM "Card" c
          WHERE c."categoryId" = cat.id AND c.published AND c."depthLevel" = 'STANDARD') AS published,
        (SELECT count(*)::int FROM "Card" c4
          WHERE c4."categoryId" = cat.id AND c4.published AND c4."depthLevel" = 'STANDARD'
            AND EXISTS (SELECT 1 FROM "UserCardInteraction" i2
              WHERE i2."cardId" = c4.id AND i2.completed)) AS seen,
        (SELECT count(*)::int FROM "UserCardInteraction" i
          JOIN "Card" c2 ON c2.id = i."cardId"
          WHERE c2."categoryId" = cat.id AND i."viewedAt" >= now() - interval '7 days') AS "views7d",
        (SELECT coalesce(sum(c3.score), 0)::int FROM "Card" c3
          WHERE c3."categoryId" = cat.id AND c3.published AND c3."depthLevel" = 'STANDARD') AS score
      FROM "Category" cat
      ORDER BY "views7d" DESC, published DESC
    `,
      prisma.$queryRaw<{ id: string; title: string; views: number; score: number }[]>`
      SELECT c.id, c.title, count(*)::int AS views, c.score
      FROM "UserCardInteraction" i
      JOIN "Card" c ON c.id = i."cardId"
      WHERE i."viewedAt" >= now() - interval '7 days'
      GROUP BY c.id ORDER BY views DESC LIMIT 5
    `,
      prisma.card.findMany({
        where: { published: true, score: { lt: 0 } },
        orderBy: { score: "asc" },
        take: 5,
        select: { id: true, title: true, score: true },
      }),
    ]);

  // Retention (spaced-repetition health) + Challenges (guess/misconception/
  // explain/checkpoint-quiz) + billing conversion — all queried unconditionally
  // alongside everything else, same as the rest of this page; a single-admin,
  // low-traffic internal panel doesn't need per-tab query splitting.
  const [
    dueReviews,
    reviewStateAgg,
    neverRetainedCount,
    cardsWithoutQuiz,
    reviewAnswered7d,
    reviewSuccess7d,
    quizAttempts,
    quizCorrect,
    guessAttempts,
    guessAccuracyAgg,
    misconceptionAttempts,
    misconceptionCorrect,
    explainAttempts,
    explainScoreAgg,
    premiumCount,
  ] = await Promise.all([
    prisma.spacedRepetitionState.count({ where: { nextReviewAt: { lte: new Date() } } }),
    prisma.spacedRepetitionState.aggregate({ _avg: { easeFactor: true, intervalDays: true } }),
    prisma.spacedRepetitionState.count({ where: { repetitionCount: 0 } }),
    prisma.card.count({
      where: { published: true, depthLevel: "STANDARD", quizCards: { none: {} } },
    }),
    prisma.xpEvent.count({ where: { kind: "review", createdAt: { gte: daysAgo(7) } } }),
    prisma.xpEvent.count({ where: { kind: "review", amount: 5, createdAt: { gte: daysAgo(7) } } }),
    prisma.userQuizAttempt.count(),
    prisma.userQuizAttempt.count({ where: { correct: true } }),
    prisma.userGuessAttempt.count(),
    prisma.userGuessAttempt.aggregate({ _avg: { accuracy: true } }),
    prisma.userMisconceptionAttempt.count(),
    prisma.userMisconceptionAttempt.count({ where: { correct: true } }),
    prisma.userExplanationAttempt.count(),
    prisma.userExplanationAttempt.aggregate({ _avg: { score: true } }),
    isBillingEnabled()
      ? prisma.user.count({
          where: {
            stripeSubscriptionStatus: { in: ["active", "trialing"] },
            stripeCurrentPeriodEnd: { gt: new Date() },
          },
        })
      : Promise.resolve(0),
  ]);

  // Fill the 14-day window so quiet days render as gaps, not omissions.
  const dayViews = new Map(
    viewsByDay.map((r) => [new Date(r.day).toISOString().slice(0, 10), r.views])
  );
  const chartDays = Array.from({ length: 14 }, (_, i) => {
    const d = daysAgo(13 - i);
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" }), views: dayViews.get(key) ?? 0 };
  });
  const maxViews = Math.max(1, ...chartDays.map((d) => d.views));

  // Group open reports by target.
  const cardReports = new Map<string, { card: NonNullable<(typeof openReports)[0]["card"]>; reports: typeof openReports }>();
  const commentReports = new Map<string, { comment: NonNullable<(typeof openReports)[0]["comment"]>; reports: typeof openReports }>();
  for (const r of openReports) {
    if (r.card) {
      const g = cardReports.get(r.card.id) ?? { card: r.card, reports: [] };
      g.reports.push(r);
      cardReports.set(r.card.id, g);
    } else if (r.comment) {
      const g = commentReports.get(r.comment.id) ?? { comment: r.comment, reports: [] };
      g.reports.push(r);
      commentReports.set(r.comment.id, g);
    }
  }

  const challengeRows = [
    { label: "Checkpoint quiz", attempts: quizAttempts, accuracy: pct(quizCorrect, quizAttempts) },
    {
      label: "Guess-before-reveal",
      attempts: guessAttempts,
      accuracy: guessAccuracyAgg._avg.accuracy != null ? `${Math.round(guessAccuracyAgg._avg.accuracy * 100)}%` : "—",
    },
    {
      label: "Misconceptions",
      attempts: misconceptionAttempts,
      accuracy: pct(misconceptionCorrect, misconceptionAttempts),
    },
    {
      label: "Explain-it-back",
      attempts: explainAttempts,
      accuracy: explainScoreAgg._avg.score != null ? `${Math.round(explainScoreAgg._avg.score * 100)}%` : "—",
    },
  ];

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <AppHeader
        streak={adminUser.currentStreak}
        longestStreak={adminUser.longestStreak}
        freezesAvailable={adminUser.streakFreezesAvailable}
        xpToday={xpToday}
        dailyGoal={DAILY_GOAL_XP}
        unread={unread}
        inviteUrl={`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/invite/${adminUserId}`}
        isAdmin
        premium={session.user.premium}
        billingEnabled={isBillingEnabled()}
        signOutAction={signOutAction}
      />
      <main className="mx-auto min-h-dvh w-full max-w-2xl px-5 pb-8 pt-[calc(env(safe-area-inset-top)+4rem)]">
      <h1 className="mt-6 text-2xl font-bold">🛠️ Admin</h1>

      <div className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? "/admin" : `/admin?tab=${t.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? "bg-violet-600 text-white"
                : "border border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <StatGrid
            tiles={[
              [userCount, "users"],
              [`${dau} / ${wau}`, "active today / 7d"],
              [newUsers7d, "new users (7d)"],
              [views7d, "views (7d)"],
              [publishedCount, "published cards"],
              [savesCount, "notebook saves"],
              [commentCount, "comments"],
              [openReports.length, "open reports"],
              ...(isBillingEnabled()
                ? ([
                    [premiumCount, "premium users"],
                    [pct(premiumCount, userCount), "premium conversion"],
                  ] as [React.ReactNode, string][])
                : []),
            ]}
          />

          {/* Views per day */}
          <h2 className="mt-10 text-lg font-bold">Views — last 14 days</h2>
          <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex h-28 items-end gap-[2px]">
              {chartDays.map((d) => (
                <div
                  key={d.key}
                  title={`${d.label} — ${d.views} view${d.views === 1 ? "" : "s"}`}
                  className="flex-1 rounded-t"
                  style={{
                    height: `${Math.max(d.views > 0 ? 4 : 1, (d.views / maxViews) * 100)}%`,
                    backgroundColor: d.views > 0 ? "#8b5cf6" : "#262626",
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-neutral-500">
              <span>{chartDays[0].label}</span>
              <span>peak {maxViews}</span>
              <span>{chartDays[13].label}</span>
            </div>
          </div>

          {/* Per-category performance */}
          <h2 className="mt-10 text-lg font-bold">Categories</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">Published</th>
                  <th className="px-4 py-2 text-right font-medium">Seen</th>
                  <th className="px-4 py-2 text-right font-medium">Views (7d)</th>
                  <th className="px-4 py-2 text-right font-medium">Net score</th>
                </tr>
              </thead>
              <tbody>
                {categoryStats.map((c) => (
                  <tr key={c.name} className="border-b border-neutral-800/50 last:border-0">
                    <td className="px-4 py-2">
                      {c.icon} {c.name}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums ${c.published < 40 ? "text-amber-400" : ""}`}>
                      {c.published}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-400">
                      {c.seen}
                      <span className="text-neutral-600">
                        {" "}
                        ({c.published > 0 ? Math.round((c.seen / c.published) * 100) : 0}%)
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.views7d}</td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        c.score > 0 ? "text-emerald-400" : c.score < 0 ? "text-red-400" : ""
                      }`}
                    >
                      {c.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Published counts in amber are below the 40-card base top-up threshold; the nightly job
            also raises a category&apos;s minimum when its most active reader is close to running out.
          </p>

          {/* Top / struggling cards */}
          <h2 className="mt-10 text-lg font-bold">Top cards this week</h2>
          {topCards.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No views in the last 7 days.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {topCards.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/card/${c.id}`}
                    className="flex items-baseline justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition hover:border-neutral-700 hover:bg-neutral-900"
                  >
                    <span className="text-sm text-neutral-200">{c.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                      {c.views} views · {c.score >= 0 ? "+" : ""}
                      {c.score}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {worstCards.length > 0 && (
            <>
              <h2 className="mt-10 text-lg font-bold">Downvoted cards</h2>
              <ul className="mt-3 space-y-1.5">
                {worstCards.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/card/${c.id}`}
                      className="flex items-baseline justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition hover:border-neutral-700 hover:bg-neutral-900"
                    >
                      <span className="text-sm text-neutral-200">{c.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-red-400">{c.score}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {tab === "retention" && (
        <>
          <StatGrid
            tiles={[
              [dueReviews, "reviews due"],
              [reviewAnswered7d, "reviews answered (7d)"],
              [pct(reviewSuccess7d, reviewAnswered7d), "review success rate (7d)"],
              [
                reviewStateAgg._avg.easeFactor != null ? reviewStateAgg._avg.easeFactor.toFixed(2) : "—",
                "avg ease factor",
              ],
              [
                reviewStateAgg._avg.intervalDays != null ? `${Math.round(reviewStateAgg._avg.intervalDays)}d` : "—",
                "avg interval",
              ],
              [neverRetainedCount, "never retained"],
              [pct(publishedCount - cardsWithoutQuiz, publishedCount), "cards with a review quiz"],
            ]}
          />
          <p className="mt-4 text-xs text-neutral-500">
            &quot;Review success rate&quot; and &quot;reviews answered&quot; are read from XP events
            (kind=&quot;review&quot;): a plain recalled review and a correctly-answered review question
            both award 5 XP and are counted as a success here, a wrong review-question answer awards 2
            and counts as a miss — there is no separate per-review attempt log, so this is the best
            available signal. &quot;Never retained&quot; is cards a user has entered spaced repetition
            for but never successfully recalled since (repetition count reset to 0). &quot;Cards with a
            review quiz&quot; tracks the backfill job (<code>scripts/enrich-cards.ts</code>) filling in
            quizzes for the existing card bank.
          </p>
        </>
      )}

      {tab === "challenges" && (
        <>
          <h2 className="mt-6 text-lg font-bold">Engagement mechanics</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
                  <th className="px-4 py-2 font-medium">Mechanic</th>
                  <th className="px-4 py-2 text-right font-medium">Attempts</th>
                  <th className="px-4 py-2 text-right font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {challengeRows.map((r) => (
                  <tr key={r.label} className="border-b border-neutral-800/50 last:border-0">
                    <td className="px-4 py-2">{r.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.attempts}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.accuracy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Guess and explain-it-back accuracy are closeness scores (0-100%), not right/wrong — both are
            graded on a continuous scale rather than a single correct answer.
          </p>
        </>
      )}

      {tab === "moderation" && (
        <>
          {/* Reported cards */}
          <h2 className="mt-6 text-lg font-bold">Reported cards</h2>
          {cardReports.size === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nothing reported. 🎉</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...cardReports.values()].map(({ card, reports }) => (
                <li key={card.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  <Link href={`/card/${card.id}`} className="font-medium hover:underline">
                    {card.title}
                  </Link>
                  <div className="mt-1 text-xs text-neutral-500">
                    {card.published ? "🟢 live" : "🔴 hidden"} ·{" "}
                    {reports.map((r) => r.reason.toLowerCase()).join(", ")}
                    {reports.some((r) => r.detail) && (
                      <span> — “{reports.find((r) => r.detail)?.detail}”</span>
                    )}
                  </div>
                  <form action={resolveCardReports} className="mt-3 flex gap-2">
                    <input type="hidden" name="cardId" value={card.id} />
                    <button name="action" value="dismiss" className={`${btn} bg-neutral-800 text-neutral-300 hover:bg-neutral-700`}>
                      Dismiss reports
                    </button>
                    {card.published ? (
                      <button name="action" value="unpublish" className={`${btn} bg-red-600 text-white hover:bg-red-500`}>
                        Unpublish card
                      </button>
                    ) : (
                      <button name="action" value="publish" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
                        Republish card
                      </button>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* Reported comments */}
          <h2 className="mt-10 text-lg font-bold">Reported comments</h2>
          {commentReports.size === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Nothing reported. 🎉</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...commentReports.values()].map(({ comment, reports }) => (
                <li key={comment.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  <p className="text-sm text-neutral-200">“{comment.body}”</p>
                  <div className="mt-1 text-xs text-neutral-500">
                    by {comment.user.email} on{" "}
                    <Link href={`/card/${comment.card.id}`} className="underline">
                      {comment.card.title}
                    </Link>{" "}
                    · {comment.hiddenAt ? "🔴 hidden" : "🟢 visible"} ·{" "}
                    {reports.map((r) => r.reason.toLowerCase()).join(", ")}
                  </div>
                  <form action={resolveCommentReports} className="mt-3 flex gap-2">
                    <input type="hidden" name="commentId" value={comment.id} />
                    <button name="action" value="dismiss" className={`${btn} bg-neutral-800 text-neutral-300 hover:bg-neutral-700`}>
                      Dismiss reports
                    </button>
                    {comment.hiddenAt ? (
                      <button name="action" value="unhide" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
                        Unhide comment
                      </button>
                    ) : (
                      <button name="action" value="hide" className={`${btn} bg-red-600 text-white hover:bg-red-500`}>
                        Hide comment
                      </button>
                    )}
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* Cards awaiting review (failed URL validation or auto-hidden) */}
          <h2 id="awaiting-review" className="mt-10 scroll-mt-20 text-lg font-bold">Cards awaiting review</h2>
          {unpublished.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No cards held back.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {unpublished.map((card) => (
                <li key={card.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="text-xs text-neutral-500">
                    {card.category.icon} {card.category.name}
                    {card.modelUsed && ` · ${card.modelUsed}`}
                  </div>
                  <Link href={`/card/${card.id}`} className="mt-1 block font-medium hover:underline">
                    {card.title}
                  </Link>
                  {card.reviewNote && (
                    <p className="mt-1 break-all text-xs text-amber-400/80">{card.reviewNote}</p>
                  )}
                  <form action={reviewCard} className="mt-3 flex gap-2">
                    <input type="hidden" name="cardId" value={card.id} />
                    <button name="action" value="publish" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
                      Publish anyway
                    </button>
                    <button name="action" value="delete" className={`${btn} bg-red-600 text-white hover:bg-red-500`}>
                      Delete card
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      </main>
    </>
  );
}
