import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getRelatedCards } from "@/lib/related";
import { timeAgo } from "@/lib/time";
import { CommentsPanel } from "@/components/feed/CommentsSheet";
import { CardActions } from "@/components/CardActions";
import { CardImage } from "@/components/CardImage";

export const dynamic = "force-dynamic";

// Shared cards are the growth loop: this page (and its OG image) is public
// so a link pasted into a chat unfurls and opens without a login wall.
// Votes, saves and comments still require an account.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const card = await prisma.card.findUnique({
    where: { id },
    select: { title: true, body: true, published: true },
  });
  // 404 must be decided here: by the time the page body runs, streaming has
  // begun and a notFound() there renders the 404 UI with a 200 status.
  if (!card) notFound();
  if (!card.published) {
    const session = await auth();
    if (!session?.user?.id) notFound();
    return { title: `${card.title} — Sparklet`, robots: { index: false } };
  }
  return {
    title: `${card.title} — Sparklet`,
    description: card.body.slice(0, 160),
    openGraph: { title: card.title, description: card.body.slice(0, 160) },
    twitter: { card: "summary_large_image", title: card.title },
  };
}

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const { id } = await params;

  const card = await prisma.card.findUnique({
    where: { id },
    include: {
      category: { select: { name: true, colorHex: true, icon: true } },
      interactions: userId ? { where: { userId }, select: { vote: true } } : false,
      savedBy: userId ? { where: { userId }, select: { id: true } } : false,
    },
  });
  if (!card || (!card.published && !userId)) notFound();

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

        {userId ? (
          <CardActions
            cardId={card.id}
            cardTitle={card.title}
            initialScore={card.score}
            initialVote={card.interactions?.[0]?.vote ?? 0}
            initialSaved={(card.savedBy?.length ?? 0) > 0}
          />
        ) : (
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
            <p className="text-sm text-neutral-300">
              ✨ Sparklet is a feed of fact-checked learning cards like this one.
            </p>
            <Link
              href="/login"
              className="mt-3 inline-block rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              Join free — start your streak
            </Link>
          </div>
        )}
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

      {userId && (
        <>
          <h2 className="mt-8 border-t border-neutral-800 pt-6 text-lg font-bold">Comments</h2>
          <div className="mt-3 max-h-[50dvh]">
            <CommentsPanel cardId={card.id} />
          </div>
        </>
      )}
    </main>
  );
}
