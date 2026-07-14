import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getRelatedCards } from "@/lib/related";
import { timeAgo } from "@/lib/time";
import { CommentsPanel } from "@/components/feed/CommentsSheet";
import { CardActions } from "@/components/CardActions";
import { CardImage } from "@/components/CardImage";

export const dynamic = "force-dynamic";

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  const userId = session.user.id;
  const card = await prisma.card.findUnique({
    where: { id },
    include: {
      category: { select: { name: true, colorHex: true, icon: true } },
      interactions: { where: { userId }, select: { vote: true } },
      savedBy: { where: { userId }, select: { id: true } },
    },
  });
  if (!card) notFound();

  const sources = card.sources as { title: string; publisher: string; url: string }[];
  const related = (await getRelatedCards([card.id], 3)).get(card.id) ?? [];

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-[calc(env(safe-area-inset-top)+2rem)]">
      <Link href="/feed" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back to feed
      </Link>

      <article className="mt-6">
        {card.imageUrl && (
          <CardImage src={card.imageUrl} className="mb-5 max-h-64 rounded-2xl" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${card.category.colorHex}33`, color: card.category.colorHex }}
          >
            {card.category.icon} {card.category.name}
          </span>
          <span className="text-xs text-neutral-500" title="When this card was published">
            published {timeAgo(card.createdAt)}
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-snug">{card.title}</h1>
        <p className="mt-3 leading-relaxed text-neutral-300">{card.body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-neutral-700 bg-neutral-900/80 px-3 py-1 text-xs text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
              title={s.title}
            >
              🔗 {s.publisher}
            </a>
          ))}
          <a
            href={card.readMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-900 transition hover:bg-white"
          >
            Read more ↗
          </a>
        </div>

        <CardActions
          cardId={card.id}
          initialScore={card.score}
          initialVote={card.interactions[0]?.vote ?? 0}
          initialSaved={card.savedBy.length > 0}
        />
      </article>

      {related.length > 0 && (
        <>
          <h2 className="mt-8 border-t border-neutral-800 pt-6 text-lg font-bold">
            Connects to
          </h2>
          <ul className="mt-3 space-y-1.5">
            {related.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/card/${r.id}`}
                  className="flex items-baseline gap-2 rounded-lg border border-transparent px-3 py-2 transition hover:border-neutral-700 hover:bg-neutral-900"
                >
                  <span className="text-xs">{r.icon}</span>
                  <span className="text-sm text-neutral-200">{r.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 border-t border-neutral-800 pt-6 text-lg font-bold">Comments</h2>
      <div className="mt-3 max-h-[50dvh]">
        <CommentsPanel cardId={card.id} />
      </div>
    </main>
  );
}
