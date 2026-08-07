import Link from "next/link";
import { prisma } from "@/lib/db";

export const metadata = { title: "Explore — Sparklet" };
// Not personalized — safe to statically cache and revalidate hourly rather
// than hitting the DB on every crawl.
export const revalidate = 3600;

export default async function ExplorePage() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      description: true,
      colorHex: true,
      icon: true,
      _count: { select: { cards: { where: { published: true, depthLevel: "STANDARD" } } } },
    },
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-12 text-neutral-100">
      <div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to Sparklet
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Explore</h1>
        <p className="mt-2 text-neutral-400">
          Fact-checked learning cards, browsable by topic — every card cites real sources.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {categories.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/explore/${c.slug}`}
              className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 transition hover:border-neutral-700 hover:bg-neutral-900"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
                style={{ backgroundColor: `${c.colorHex}33`, color: c.colorHex }}
              >
                {c.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.name}</div>
                <div className="truncate text-sm text-neutral-400">{c.description}</div>
              </div>
              <span className="shrink-0 text-xs text-neutral-500">{c._count.cards} cards</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
