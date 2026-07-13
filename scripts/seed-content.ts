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
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { contentFileSchema, contentHash, type CardInput, type QuizInput } from "../src/lib/content-schema";
import { embedText, cosineSimilarity, verifierFor, generateJSONWith } from "../src/lib/ai-provider";

const DUPLICATE_THRESHOLD = 0.92; // cosine similarity above this = near-duplicate

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
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    return res.status;
  };

  let alive = false;
  for (let retry = 0; retry < 3; retry++) {
    try {
      let status = await attempt("HEAD");
      // Some sites reject HEAD (405/403) but serve GET fine.
      if (status >= 400 && status !== 429 && status !== 503) status = await attempt("GET");
      if (status >= 200 && status < 400) {
        alive = true;
        break;
      }
      if (status === 429 || status === 503) {
        if (retry < 2) {
          await sleepMs(3_000 * (retry + 1));
          continue;
        }
        // Still throttled after backoff: the host is responding, so this is
        // NOT a dead link — don't fail the fact-check gate over rate limits.
        alive = true;
        break;
      }
      alive = false; // real 4xx/5xx after both methods
      break;
    } catch {
      // Network error/timeout — retry, then treat as dead.
      if (retry < 2) await sleepMs(2_000);
      else alive = false;
    }
  }
  urlCache.set(url, alive);
  return alive;
}

/** "https://en.wikipedia.org/wiki/Ada_Lovelace" → "Ada Lovelace" */
function wikiTitleFromUrl(url: string): string | null {
  const m = url.match(/^https:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/_/g, " ");
  } catch {
    return null;
  }
}

/**
 * Best-effort image for a card: explicit title first, then any Wikipedia
 * article among its sources/read-more link — many cards cite an article
 * whose lead image fits even when the model omitted imageWikipediaTitle.
 */
async function resolveCardImage(card: {
  imageWikipediaTitle?: string | null;
  readMoreUrl: string;
  sources: { url: string }[];
}): Promise<string | null> {
  const candidates = [
    card.imageWikipediaTitle,
    wikiTitleFromUrl(card.readMoreUrl),
    ...card.sources.map((s) => wikiTitleFromUrl(s.url)),
  ].filter((t): t is string => !!t);

  for (const title of [...new Set(candidates)]) {
    const url = await resolveWikipediaImage(title);
    if (url && (await urlIsAlive(url))) return url;
  }
  return null;
}

/** Resolve a Wikipedia article's lead image thumbnail (free, verifiable). */
async function resolveWikipediaImage(title: string): Promise<string | null> {
  for (let retry = 0; retry < 3; retry++) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) }
      );
      if (res.status === 429 || res.status === 503) {
        await sleepMs(3_000 * (retry + 1));
        continue;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as { thumbnail?: { source?: string } };
      return data.thumbnail?.source ?? null;
    } catch {
      if (retry < 2) await sleepMs(2_000);
    }
  }
  return null;
}

/** Crude HTML → text for fact-check context. */
async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3500);
  } catch {
    return null;
  }
}

/**
 * Second-model fact-check: the provider that did NOT generate the card reads
 * the actual source text and judges whether it supports the card's claims.
 * Only a hard "no" blocks publish — scraping fails on paywalled/JS pages, so
 * "unverifiable" must not auto-reject.
 */
async function crossVerify(
  card: CardInput,
  modelUsed: string | undefined
): Promise<{ verdict: "yes" | "partial" | "no" | "skipped"; note?: string }> {
  const verifier = verifierFor(modelUsed);
  if (!verifier) return { verdict: "skipped" };

  const excerpts: string[] = [];
  for (const s of card.sources.slice(0, 2)) {
    const text = await fetchPageText(s.url);
    if (text) excerpts.push(`SOURCE (${s.publisher} — ${s.url}):\n${text}`);
  }
  if (excerpts.length === 0) return { verdict: "skipped", note: "no source text retrievable" };

  const prompt = `You are fact-checking a learning card against the actual text of its cited sources. Judge whether the sources support the card's specific factual claims — names, numbers, dates, causal statements. Do not judge writing quality.

CARD TITLE: ${card.title}
CARD BODY: ${card.body}

${excerpts.join("\n\n")}

Respond with JSON only: {"verdict": "yes" | "partial" | "no", "note": "<one line: which claim is unsupported or contradicted, if any>"}
- "yes": every specific claim is supported by the source text.
- "partial": the core claim is supported but a detail is not confirmed by this text (it may be elsewhere in the source).
- "no": the source text CONTRADICTS a claim, or the central claim is absent entirely.`;

  try {
    const { text } = await generateJSONWith(verifier, prompt);
    const parsed = JSON.parse(text) as { verdict?: string; note?: string };
    if (parsed.verdict === "yes" || parsed.verdict === "partial" || parsed.verdict === "no") {
      return { verdict: parsed.verdict, note: parsed.note };
    }
    return { verdict: "skipped", note: "verifier returned malformed output" };
  } catch (e) {
    return { verdict: "skipped", note: `verifier error: ${e instanceof Error ? e.message.slice(0, 100) : e}` };
  }
}

// Per-category cache of published-card embeddings for duplicate detection.
const embeddingCache = new Map<string, { id: string; title: string; vector: number[] }[]>();

async function loadCategoryEmbeddings(categoryId: string) {
  let cached = embeddingCache.get(categoryId);
  if (!cached) {
    const rows = await prisma.card.findMany({
      where: { categoryId, embedding: { not: Prisma.DbNull } },
      select: { id: true, title: true, embedding: true },
    });
    cached = rows
      .filter((r) => Array.isArray(r.embedding))
      .map((r) => ({ id: r.id, title: r.title, vector: r.embedding as number[] }));
    embeddingCache.set(categoryId, cached);
  }
  return cached;
}

async function importCard(card: CardInput, modelUsed: string | undefined, stats: Record<string, number>): Promise<string | null> {
  const hash = contentHash(card);
  const existing = await prisma.card.findUnique({ where: { contentHash: hash } });
  if (existing) {
    stats.skipped++;
    return existing.id;
  }

  const category = await prisma.category.findUnique({ where: { slug: card.category } });
  if (!category) {
    console.warn(`  ! Unknown category "${card.category}" for "${card.title}" — skipping`);
    stats.badCategory++;
    return null;
  }

  // Fact-check gate: every cited URL must be alive.
  const urlsToCheck = [...card.sources.map((s) => s.url), card.readMoreUrl];
  const deadUrls: string[] = [];
  for (const url of urlsToCheck) {
    if (!(await urlIsAlive(url))) deadUrls.push(url);
  }

  let imageUrl = card.imageUrl ?? null;
  if (imageUrl && !(await urlIsAlive(imageUrl))) imageUrl = null;
  if (!imageUrl) imageUrl = await resolveCardImage(card);

  let published = deadUrls.length === 0;
  let reviewNote = published ? null : `Dead source URL(s): ${deadUrls.join(", ")}`;
  let embedding: number[] | null = null;

  if (published) {
    // Near-duplicate check (embeddings; skipped when no Gemini key).
    embedding = await embedText(`${card.title}\n${card.body}`);
    if (embedding) {
      const existingVectors = await loadCategoryEmbeddings(category.id);
      const duplicate = existingVectors.find(
        (e) => cosineSimilarity(e.vector, embedding!) >= DUPLICATE_THRESHOLD
      );
      if (duplicate) {
        console.warn(`  ! "${card.title}" skipped — near-duplicate of "${duplicate.title}"`);
        stats.duplicates++;
        return null;
      }
    }

    // Cross-model fact-check against the actual source text.
    const check = await crossVerify(card, modelUsed);
    if (check.verdict === "no") {
      published = false;
      reviewNote = `Fact-check failed (${modelUsed ?? "?"} card, cross-checked): ${check.note ?? "source contradicts claim"}`;
    }
  }

  const created = await prisma.card.create({
    data: {
      categoryId: category.id,
      type: card.type,
      title: card.title,
      body: card.body,
      imageUrl,
      sources: card.sources,
      readMoreUrl: card.readMoreUrl,
      published,
      reviewNote,
      contentHash: hash,
      modelUsed: modelUsed ?? null,
      embedding: embedding ?? Prisma.DbNull,
      lastValidatedAt: new Date(),
    },
  });
  if (published) {
    stats.published++;
    if (embedding) {
      embeddingCache
        .get(category.id)
        ?.push({ id: created.id, title: created.title, vector: embedding });
    }
  } else {
    stats.review++;
    console.warn(`  ! "${card.title}" held for review — ${reviewNote}`);
  }
  return created.id;
}

async function importQuizzes(
  quizzes: QuizInput[],
  cardIds: (string | null)[],
  stats: Record<string, number>
) {
  for (const quiz of quizzes) {
    const cardId = cardIds[quiz.cardIndex];
    if (!cardId) continue;
    const existing = await prisma.quizCard.findFirst({
      where: { cardId, question: quiz.question },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.quizCard.create({
      data: {
        cardId,
        question: quiz.question,
        options: quiz.options,
        correctIndex: quiz.correctIndex,
        explanation: quiz.explanation,
      },
    });
    stats.quizzes++;
  }
}

async function main() {
  const files = await listJsonFiles(CONTENT_DIR);
  console.log(`Found ${files.length} content file(s).`);
  const stats = {
    published: 0,
    review: 0,
    skipped: 0,
    badCategory: 0,
    invalidFile: 0,
    duplicates: 0,
    quizzes: 0,
  };

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
    const cardIds: (string | null)[] = [];
    for (const card of parsed.cards) {
      cardIds.push(await importCard(card, parsed.model, stats));
    }
    if (parsed.quizzes?.length) {
      await importQuizzes(parsed.quizzes, cardIds, stats);
    }
  }

  console.log(
    `Done. published=${stats.published} heldForReview=${stats.review} alreadyPresent=${stats.skipped} nearDuplicates=${stats.duplicates} quizzes=${stats.quizzes} badCategory=${stats.badCategory} invalidFiles=${stats.invalidFile}`
  );

  // Backfill: cards imported before the source-URL image fallback existed
  // (or whose lookup failed transiently) get another chance each deploy.
  const imageless = await prisma.card.findMany({
    where: { imageUrl: null },
    select: { id: true, title: true, readMoreUrl: true, sources: true },
    take: 200,
  });
  let backfilled = 0;
  for (const card of imageless) {
    const imageUrl = await resolveCardImage({
      readMoreUrl: card.readMoreUrl,
      sources: card.sources as { url: string }[],
    });
    if (imageUrl) {
      await prisma.card.update({ where: { id: card.id }, data: { imageUrl } });
      backfilled++;
    }
    await sleepMs(150); // stay well under Wikipedia's rate limits
  }
  if (imageless.length) {
    console.log(`Image backfill: ${backfilled}/${imageless.length} imageless card(s) resolved.`);
  }

  // Re-check cards held for "dead" links — transient throttling at import
  // time can false-positive, and those should heal on a later run.
  const held = await prisma.card.findMany({
    where: { published: false, reviewNote: { startsWith: "Dead source URL" } },
    select: { id: true, title: true, readMoreUrl: true, sources: true },
    take: 100,
  });
  let healed = 0;
  for (const card of held) {
    const urls = [...(card.sources as { url: string }[]).map((s) => s.url), card.readMoreUrl];
    let allAlive = true;
    for (const url of urls) {
      if (!(await urlIsAlive(url))) {
        allAlive = false;
        break;
      }
    }
    if (allAlive) {
      await prisma.card.update({
        where: { id: card.id },
        data: { published: true, reviewNote: null },
      });
      healed++;
    }
    await sleepMs(150);
  }
  if (held.length) {
    console.log(`Held-card recheck: ${healed}/${held.length} republished (links verified alive).`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
