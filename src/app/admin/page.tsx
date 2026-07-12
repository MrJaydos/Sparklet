import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";

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

export default async function AdminPage() {
  await requireAdmin();

  const [userCount, publishedCount, unpublished, openReports, commentCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.card.count({ where: { published: true } }),
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

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-5 py-8">
      <Link href="/feed" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back to feed
      </Link>
      <h1 className="mt-6 text-2xl font-bold">🛠️ Admin</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        {[
          [userCount, "users"],
          [publishedCount, "published cards"],
          [commentCount, "comments"],
          [openReports.length, "open reports"],
        ].map(([n, label]) => (
          <div key={label} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-2xl font-bold">{n}</div>
            <div className="mt-1 text-xs text-neutral-400">{label}</div>
          </div>
        ))}
      </div>

      {/* Reported cards */}
      <h2 className="mt-10 text-lg font-bold">Reported cards</h2>
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
      <h2 className="mt-10 text-lg font-bold">Cards awaiting review</h2>
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
    </main>
  );
}
