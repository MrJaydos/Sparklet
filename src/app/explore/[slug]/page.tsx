import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";

// force-dynamic (not ISR/revalidate): the Docker build runs against a fake
// placeholder DB with no real data (see AGENTS.md — DB is only written at
// deploy time), so build-time static generation would fail here the same
// way every other Prisma-backed page in this app avoids it.
export const dynamic = "force-dynamic";

// Hub pages don't need to be exhaustive — the sitemap already lists every
// card page directly. This just needs to give crawlers (and readers) a real
// set of internal links into the highest-value cards per topic.
const CARDS_PER_CATEGORY = 200;

async function getCategory(slug: string) {
  return prisma.category.findUnique({
    where: { slug },
    select: { name: true, description: true, colorHex: true, icon: true },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return {};
  return {
    title: `${category.name} — Sparklet`,
    description: category.description,
  };
}

export default async function ExploreCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();

  const cards = await prisma.card.findMany({
    where: { category: { slug }, published: true, depthLevel: "STANDARD" },
    select: { id: true, title: true, body: true },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: CARDS_PER_CATEGORY,
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-6 py-12 text-neutral-100">
      <div>
        <Link href="/explore" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← All topics
        </Link>
        <h1 className="mt-4 flex items-center gap-2 text-3xl font-bold tracking-tight">
          <span style={{ color: category.colorHex }}>{category.icon}</span>
          {category.name}
        </h1>
        <p className="mt-2 text-neutral-400">{category.description}</p>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-neutral-500">No published cards in this topic yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/card/${c.id}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 transition hover:border-neutral-700 hover:bg-neutral-900"
              >
                <div className="font-semibold">{c.title}</div>
                <div className="mt-1 line-clamp-2 text-sm text-neutral-400">{c.body}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
