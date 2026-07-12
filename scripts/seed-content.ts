/**
 * Idempotent content importer. Reads every JSON file under /content
 * (curated + generated), dedupes against the DB by content hash, validates
 * all source URLs, and upserts cards.
 *
 * Cards are only `published: true` if every source URL and the read-more URL
 * respond successfully — dead links keep a card unpublished with a review
 * note instead of shipping a broken citation to users.
 *
 * Runs on every deploy (after `prisma migrate deploy`); safe to re-run.
 */
import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { contentFileSchema, contentHash, type CardInput } from "../src/lib/content-schema";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const CONTENT_DIR = join(process.cwd(), "content");
const UA = "SparkletBot/1.0 (content source validation; contact: admin@sparklet)";

async function listJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJsonFiles(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const urlCache = new Map<string, boolean>();

async function urlIsAlive(url: string): Promise<boolean> {
  const cached = urlCache.get(url);
  if (cached !== undefined) return cached;

  const attempt = async (method: "HEAD" | "GET") => {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(10_000),
    });
    return res.status >= 200 && res.status < 400;
  };

  let alive = false;
  try {
    alive = await attempt("HEAD");
    // Some sites reject HEAD (405/403) but serve GET fine.
    if (!alive) alive = await attempt("GET");
  } catch {
    try {
      alive = await attempt("GET");
    } catch {
      alive = false;
    }
  }
  urlCache.set(url, alive);
  return alive;
}

/** Resolve a Wikipedia article's lead image thumbnail (free, verifiable). */
async function resolveWikipediaImage(title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail?: { source?: string } };
    return data.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

async function importCard(card: CardInput, modelUsed: string | undefined, stats: Record<string, number>) {
  const hash = contentHash(card);
  const existing = await prisma.card.findUnique({ where: { contentHash: hash } });
  if (existing) {
    stats.skipped++;
    return;
  }

  const category = await prisma.category.findUnique({ where: { slug: card.category } });
  if (!category) {
    console.warn(`  ! Unknown category "${card.category}" for "${card.title}" — skipping`);
    stats.badCategory++;
    return;
  }

  // Fact-check gate: every cited URL must be alive.
  const urlsToCheck = [...card.sources.map((s) => s.url), card.readMoreUrl];
  const deadUrls: string[] = [];
  for (const url of urlsToCheck) {
    if (!(await urlIsAlive(url))) deadUrls.push(url);
  }

  let imageUrl = card.imageUrl ?? null;
  if (!imageUrl && card.imageWikipediaTitle) {
    imageUrl = await resolveWikipediaImage(card.imageWikipediaTitle);
  }
  if (imageUrl && !(await urlIsAlive(imageUrl))) imageUrl = null;

  const published = deadUrls.length === 0;
  await prisma.card.create({
    data: {
      categoryId: category.id,
      type: card.type,
      title: card.title,
      body: card.body,
      imageUrl,
      sources: card.sources,
      readMoreUrl: card.readMoreUrl,
      published,
      reviewNote: published ? null : `Dead source URL(s): ${deadUrls.join(", ")}`,
      contentHash: hash,
      modelUsed: modelUsed ?? null,
    },
  });
  if (published) stats.published++;
  else {
    stats.review++;
    console.warn(`  ! "${card.title}" held for review — dead URLs: ${deadUrls.join(", ")}`);
  }
}

async function main() {
  const files = await listJsonFiles(CONTENT_DIR);
  console.log(`Found ${files.length} content file(s).`);
  const stats = { published: 0, review: 0, skipped: 0, badCategory: 0, invalidFile: 0 };

  for (const file of files) {
    let parsed;
    try {
      parsed = contentFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (e) {
      console.warn(`  ! Invalid content file ${file}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      stats.invalidFile++;
      continue;
    }
    console.log(`Importing ${parsed.cards.length} card(s) from ${file}`);
    for (const card of parsed.cards) {
      await importCard(card, parsed.model, stats);
    }
  }

  console.log(
    `Done. published=${stats.published} heldForReview=${stats.review} alreadyPresent=${stats.skipped} badCategory=${stats.badCategory} invalidFiles=${stats.invalidFile}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
