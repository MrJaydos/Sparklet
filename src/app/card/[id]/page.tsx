import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { CommentsPanel } from "@/components/feed/CommentsSheet";

export const dynamic = "force-dynamic";

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  const card = await prisma.card.findUnique({
    where: { id },
    include: { category: { select: { name: true, colorHex: true, icon: true } } },
  });
  if (!card) notFound();

  const sources = card.sources as { title: string; publisher: string; url: string }[];

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-8">
      <Link href="/feed" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Back to feed
      </Link>

      <article className="mt-6">
        {card.imageUrl && (
          <div className="mb-5 max-h-64 overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.imageUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: `${card.category.colorHex}33`, color: card.category.colorHex }}
        >
          {card.category.icon} {card.category.name}
        </span>
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
      </article>

      <h2 className="mt-8 border-t border-neutral-800 pt-6 text-lg font-bold">Comments</h2>
      <div className="mt-3 max-h-[50dvh]">
        <CommentsPanel cardId={card.id} />
      </div>
    </main>
  );
}
