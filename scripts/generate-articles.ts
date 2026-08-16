/**
 * Deploy-time article backfill: give every published STANDARD card the
 * long-form companion article that /card/[id] needs to be worth indexing.
 *
 * Runs in the background after content import (scripts/start-prod.sh), needs
 * AI keys, and degrades to a no-op without them. Card.articleAt marks a card
 * as examined whether or not it produced a usable article, so each deploy
 * only works the remaining backlog.
 *
 * One card per model call, deliberately: unlike quiz/guess enrichment (12
 * cards a call, a couple of lines each) an 800-word grounded article is the
 * whole completion, and batching them collapses quality and blows the output
 * token ceiling.
 */
import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateJSONWith } from "../src/lib/ai-provider";
import { articleSchema, countArticleWords, ARTICLE_MIN_WORDS } from "../src/lib/article";
import { publisherForUrl, type StoredSource } from "../src/lib/source-attribution";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Shares the Gemini daily quota with generation, verification, enrichment and
// live depth requests, and each call here is far larger than an enrichment
// call — so the per-run ceiling is lower. The backlog drains over successive
// deploys; nothing depends on it finishing in one.
const MAX_PER_RUN = Number(process.env.ARTICLE_MAX_PER_RUN) || 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Target well above ARTICLE_MIN_WORDS. Asking for 800-1100 produced ~660
// words in practice — models systematically under-deliver on length, and at
// that setting most articles landed under the 600-word floor and weren't
// indexable (6 of 40 cleared it on the first production run). Overshooting
// the ask is the correction; the floor stays where it is.
const TARGET_WORDS = "1100-1500";

function buildPrompt(card: {
  title: string;
  body: string;
  categoryName: string;
  sources: StoredSource[];
}) {
  const sourceList = card.sources
    .map((s) => `- ${publisherForUrl(s.url)}: ${s.title} (${s.url})`)
    .join("\n");

  return `You are writing the full article behind a short learning card on Sparklet, a fact-checked learning site. The card is a ${card.categoryName} card. Readers swipe the short version in the feed, then open this article to actually understand the topic.

CARD TITLE: ${card.title}
CARD BODY (the hook — the article must expand on this, not merely repeat it): ${card.body}

CITED SOURCES:
${sourceList}

Write a ${TARGET_WORDS} word article. Requirements:

GROUNDING — this is the hard constraint:
- Stay strictly within what the cited sources support. Do NOT invent statistics, dates, names, quotes or studies.
- Where the precise figure or date is not something you are confident the sources establish, write about the fact qualitatively instead of inventing a number.
- Do not attribute anything to an institution unless the sources actually show that attribution.
- If you cannot write ${TARGET_WORDS} grounded words on this topic, write fewer — a shorter honest article is correct, and the caller will discard it.

SUBSTANCE — the article must add value the card does not have. Cover, as the topic allows:
- the mechanism or explanation behind the fact (why is this so?)
- the history or discovery — how this came to be known or to happen
- wider context: what it connects to, what it changed, why it matters
- nuance: common misunderstandings, what is genuinely disputed or uncertain, what the limits of the evidence are

STYLE:
- Plain, concrete, curious prose for a general reader. No filler, no "in conclusion", no restating the brief.
- Never address the reader as a student and never mention "the card" or "this article".

Respond with JSON only:
{
  "sections": [
    { "heading": "<short section heading, under 60 chars>", "paragraphs": ["<paragraph>", "<paragraph>"] }
  ],
  "keyTakeaways": ["<one specific, substantive takeaway>", "..."]
}
Use 5-7 sections of 2-3 substantial paragraphs each — aim for roughly 100-150 words per paragraph, not one-liners — and 3-4 key takeaways. Every paragraph must be at least 40 characters.`;
}

/**
 * A provider-level failure is not a bad card — it means every remaining call
 * this run will fail the same way. Detected so the run stops and leaves the
 * backlog untouched, instead of walking the whole queue stamping good cards
 * as examined and permanently skipping them.
 *
 * Covers both failure modes seen in practice: 429 RESOURCE_EXHAUSTED
 * ("prepayment credits are depleted", which killed the nightly top-up for
 * five runs) and 403 PERMISSION_DENIED ("your project has been denied
 * access"), which survives a credit top-up and needs Google support.
 */
function isProviderUnavailable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /RESOURCE_EXHAUSTED|PERMISSION_DENIED|UNAUTHENTICATED|prepayment credits|denied access|quota|API key not valid|\b(401|403|429)\b/i.test(
    msg
  );
}

class ProviderUnavailable extends Error {}

async function generateFor(card: {
  id: string;
  title: string;
  body: string;
  categoryName: string;
  sources: StoredSource[];
}): Promise<{ ok: boolean; words: number; reason?: string }> {
  let raw: string;
  try {
    // Gemini explicitly rather than generateJSON's Gemini→Groq fallback.
    // Articles are the whole anti-thin-content play; a weaker model's
    // 800 words would be written once, marked examined, and never revisited.
    // Better to wait for Gemini than to permanently fill the slot.
    raw = (await generateJSONWith("gemini", buildPrompt(card))).text;
  } catch (e) {
    if (isProviderUnavailable(e))
      throw new ProviderUnavailable(e instanceof Error ? e.message : String(e));
    return { ok: false, words: 0, reason: `model error: ${e instanceof Error ? e.message.slice(0, 120) : e}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, words: 0, reason: "response was not valid JSON" };
  }

  const parsed = articleSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, words: 0, reason: `malformed: ${parsed.error.issues[0]?.message ?? "?"}` };
  }

  const words = countArticleWords(parsed.data);
  if (words < ARTICLE_MIN_WORDS) {
    // Keep it anyway — a 500-word article still beats a bare card body for a
    // reader who tapped through. It just doesn't clear the indexability
    // floor, and articleWords is what enforces that.
    await prisma.card.update({
      where: { id: card.id },
      data: { article: parsed.data, articleWords: words, articleAt: new Date() },
    });
    return { ok: false, words, reason: `under ${ARTICLE_MIN_WORDS} words (kept, not indexable)` };
  }

  await prisma.card.update({
    where: { id: card.id },
    data: { article: parsed.data, articleWords: words, articleAt: new Date() },
  });
  return { ok: true, words };
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    // Gemini-only by design (see generateFor) — no Groq fallback here.
    console.log("[articles] no GEMINI_API_KEY — skipping.");
    return;
  }

  // ARTICLE_RETRY_SHORT=1 re-attempts cards that were already examined but
  // aren't indexable — ones whose article came in under the floor, or whose
  // generation failed. Opt-in rather than automatic: without the flag a
  // topic that genuinely can't support 600 grounded words would be retried
  // on every deploy forever. Use it after changing the prompt or the target
  // length, which is exactly when the earlier verdicts stop being valid.
  const retryShort = process.env.ARTICLE_RETRY_SHORT === "1";
  const where: Prisma.CardWhereInput = {
    published: true,
    depthLevel: "STANDARD",
    ...(retryShort
      ? {
          OR: [
            { articleAt: null },
            { articleWords: null },
            { articleWords: { lt: ARTICLE_MIN_WORDS } },
          ],
        }
      : { articleAt: null }),
  };
  if (retryShort) console.log("[articles] ARTICLE_RETRY_SHORT=1 — re-attempting non-indexable articles.");

  const remaining = await prisma.card.count({ where });
  const cards = await prisma.card.findMany({
    where,
    // Highest-scoring first: if the run is capped, the cards most likely to
    // be read (and linked) get their article first.
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: MAX_PER_RUN,
    select: {
      id: true,
      title: true,
      body: true,
      sources: true,
      category: { select: { name: true } },
    },
  });

  console.log(`[articles] ${remaining} card(s) without an article; processing ${cards.length} this run.`);

  let written = 0;
  let short = 0;
  let failed = 0;

  for (const [i, c] of cards.entries()) {
    let result;
    try {
      result = await generateFor({
        id: c.id,
        title: c.title,
        body: c.body,
        categoryName: c.category.name,
        sources: (c.sources as StoredSource[]) ?? [],
      });
    } catch (e) {
      if (e instanceof ProviderUnavailable) {
        console.warn(
          `[articles] stopping after ${written} article(s) — Gemini unavailable: ${e.message.slice(0, 200)}`
        );
        console.warn("[articles] backlog left untouched; resumes once the provider works again.");
        break;
      }
      throw e;
    }

    if (result.ok) {
      written++;
      console.log(`  [${i + 1}/${cards.length}] ✓ ${c.title} (${result.words}w)`);
    } else if (result.words > 0) {
      short++;
      console.log(`  [${i + 1}/${cards.length}] ~ ${c.title} — ${result.reason}`);
    } else {
      failed++;
      console.warn(`  [${i + 1}/${cards.length}] ✗ ${c.title} — ${result.reason}`);
      // Mark examined so a permanently-failing card can't stall every future
      // run at the head of the queue. score-desc ordering would otherwise
      // hand it back first every single deploy.
      await prisma.card.update({
        where: { id: c.id },
        data: { articleAt: new Date() },
      });
    }
    await sleep(1200); // stay under provider rate limits
  }

  console.log(
    `[articles] done — ${written} indexable, ${short} kept but short, ${failed} failed. ` +
      `${Math.max(0, remaining - cards.length)} still queued for the next deploy.`
  );
}

main()
  .catch((e) => {
    console.error("[articles] fatal:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
