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
import {
  generateJSON,
  submitBatch,
  listBatches,
  getBatch,
  batchResults,
  deleteBatch,
  batchingAvailable,
} from "../src/lib/ai-provider";
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

type ArticleCard = {
  id: string;
  title: string;
  body: string;
  categoryName: string;
  sources: StoredSource[];
};

// Batch mode (--batch): one job in flight at a time, collected by a later
// run. Same submit-then-collect-next-time rhythm as the nightly content
// top-up, and the same reason — batch is ~half price and nothing is waiting
// on the result. Prefix is distinct from "sparklet-topup-" so the two
// features never see each other's jobs.
const BATCH_PREFIX = "sparklet-articles-";
const BATCH_DONE_STATES = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_PARTIALLY_SUCCEEDED"]);
const BATCH_TERMINAL_FAILURE_STATES = new Set([
  "JOB_STATE_FAILED",
  "JOB_STATE_CANCELLED",
  "JOB_STATE_EXPIRED",
]);

// Cards per submitted batch. Sized for ongoing volume (~70 new cards a night)
// with headroom, deliberately well short of the whole bank: requests go up as
// inline payload, so a batch of ~1,000 prompts would be several MB and is
// untested against the inline-request limit. Draining a large backlog is what
// the synchronous mode is for.
const BATCH_MAX = Number(process.env.ARTICLE_BATCH_MAX) || 200;

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
 * Covers every failure mode seen in practice: 429 RESOURCE_EXHAUSTED
 * ("prepayment credits are depleted", which killed the nightly top-up for
 * five runs); 403 PERMISSION_DENIED ("your project has been denied access"),
 * which survives a credit top-up and needs Google support; and 5xx overload
 * ("this model is currently experiencing high demand"), which Flash returns
 * in bursts. generateJSON already retries the transient ones with backoff, so
 * reaching here means they didn't clear — treat that as an outage and stop,
 * rather than walking the rest of the backlog stamping cards as examined.
 */
function isProviderUnavailable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /RESOURCE_EXHAUSTED|PERMISSION_DENIED|UNAUTHENTICATED|UNAVAILABLE|prepayment credits|denied access|high demand|overloaded|quota|API key not valid|\b(401|403|429|500|502|503|504)\b/i.test(
    msg
  );
}

class ProviderUnavailable extends Error {}

/**
 * Validate one model response and store it against a card. Shared by both
 * modes so a batch-produced article goes through exactly the same floor and
 * schema checks as a synchronous one — the only difference between the modes
 * should be how the text was obtained.
 */
async function applyArticle(
  cardId: string,
  raw: string
): Promise<{ ok: boolean; words: number; reason?: string }> {
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
  // Stored either way — a 500-word article still beats a bare card body for a
  // reader who tapped through. It just doesn't clear the indexability floor,
  // and articleWords is what enforces that.
  await prisma.card.update({
    where: { id: cardId },
    data: { article: parsed.data, articleWords: words, articleAt: new Date() },
  });

  return words >= ARTICLE_MIN_WORDS
    ? { ok: true, words }
    : { ok: false, words, reason: `under ${ARTICLE_MIN_WORDS} words (kept, not indexable)` };
}

async function generateFor(card: ArticleCard): Promise<{ ok: boolean; words: number; reason?: string }> {
  let raw: string;
  try {
    // generateJSON, not generateJSONWith("gemini", ...): both are Gemini-only
    // now that the Groq fallback is gone, but only generateJSON retries 5xx
    // and 429 with backoff. Going direct meant a single transient 503 —
    // "this model is currently experiencing high demand", which Flash returns
    // in bursts — burned the card as a per-card failure and skipped it for good.
    raw = (await generateJSON(buildPrompt(card))).text;
  } catch (e) {
    if (isProviderUnavailable(e))
      throw new ProviderUnavailable(e instanceof Error ? e.message : String(e));
    return { ok: false, words: 0, reason: `model error: ${e instanceof Error ? e.message.slice(0, 120) : e}` };
  }
  return applyArticle(card.id, raw);
}

/**
 * Cards still needing an article, best-first.
 *
 * ARTICLE_RETRY_SHORT=1 re-attempts cards that were already examined but
 * aren't indexable — ones whose article came in under the floor, or whose
 * generation failed. Opt-in rather than automatic: without the flag a topic
 * that genuinely can't support 600 grounded words would be retried on every
 * deploy forever. Use it after changing the prompt or the target length,
 * which is exactly when the earlier verdicts stop being valid.
 */
async function selectCards(take: number): Promise<{ cards: ArticleCard[]; remaining: number }> {
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
  const rows = await prisma.card.findMany({
    where,
    // Highest-scoring first: if the run is capped, the cards most likely to
    // be read (and linked) get their article first.
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      title: true,
      body: true,
      sources: true,
      category: { select: { name: true } },
    },
  });

  return {
    remaining,
    cards: rows.map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      categoryName: c.category.name,
      sources: (c.sources as StoredSource[]) ?? [],
    })),
  };
}

/**
 * Batch mode: collect whatever a previous run submitted, then submit a new
 * job if nothing is still in flight. Half price, ~24h turnaround, and immune
 * to the 503 bursts that stall the synchronous path — nothing is waiting on
 * these, so latency is free. Meant for the ongoing trickle of new cards;
 * draining a big backlog is what the synchronous mode is for.
 */
async function runBatch() {
  if (!batchingAvailable()) {
    console.log("[articles] batch mode unavailable (no GEMINI_API_KEY) — skipping.");
    return;
  }

  const jobs = await listBatches(BATCH_PREFIX);
  let inFlight = false;
  let written = 0;
  let short = 0;
  let failed = 0;

  for (const job of jobs) {
    const state = job.state as string | undefined;

    if (state && BATCH_DONE_STATES.has(state)) {
      console.log(`[articles] collecting batch ${job.displayName} (${state})…`);
      // batches.list() returns summaries only — the actual inlined responses
      // come back from batches.get() on this specific job. Same trap the
      // top-up documents: skipping this silently collects zero articles from
      // a job that actually succeeded.
      const full = job.name ? await getBatch(job.name) : null;
      const results = full ? batchResults(full) : [];

      if (results.length === 0 || results.every((r) => !r.key)) {
        console.error(
          `[articles] ✗✗ batch ${job.displayName}: ${
            results.length === 0
              ? "batches.get() returned no results for a job in a done state"
              : `none of ${results.length} result(s) carried a metadata.key`
          } — cannot attribute these articles to cards. Discarding.`
        );
        if (job.name) await deleteBatch(job.name);
        continue;
      }

      for (const { key: cardId, text, error, finishReason } of results) {
        if (!cardId) continue;
        if (!text) {
          // Left unmarked so the next submission picks the card up again.
          failed++;
          console.warn(
            `  ✗ ${cardId}: batch item failed (${error}${finishReason ? `, ${finishReason}` : ""}) — retries next run`
          );
          continue;
        }
        const result = await applyArticle(cardId, text);
        if (result.ok) {
          written++;
        } else if (result.words > 0) {
          short++;
        } else {
          failed++;
          console.warn(`  ✗ ${cardId}: ${result.reason}`);
          // Same reasoning as the synchronous path: mark examined so a card
          // the model can't produce valid JSON for doesn't head the queue on
          // every future run.
          await prisma.card.update({ where: { id: cardId }, data: { articleAt: new Date() } });
        }
      }
      if (job.name) await deleteBatch(job.name);
    } else if (state && BATCH_TERMINAL_FAILURE_STATES.has(state)) {
      console.warn(`[articles] batch ${job.displayName} ended in ${state} — discarding, cards retry next run`);
      if (job.name) await deleteBatch(job.name);
    } else {
      console.log(`[articles] batch ${job.displayName} still ${state ?? "unknown"} — skipping submission this run`);
      inFlight = true;
    }
  }

  if (written || short || failed) {
    console.log(`[articles] collected — ${written} indexable, ${short} kept but short, ${failed} to retry.`);
  }

  if (inFlight) return;

  // Selected after collection, so cards just written aren't resubmitted.
  const { cards, remaining } = await selectCards(BATCH_MAX);
  if (cards.length === 0) {
    console.log("[articles] nothing to submit — every card has an article.");
    return;
  }

  try {
    const displayName = `${BATCH_PREFIX}${new Date().toISOString().slice(0, 10)}`;
    const name = await submitBatch(
      cards.map((c) => ({ key: c.id, prompt: buildPrompt(c) })),
      displayName
    );
    console.log(
      `[articles] submitted batch ${name} (${displayName}) for ${cards.length} card(s); ` +
        `${Math.max(0, remaining - cards.length)} more queued for later runs.`
    );
  } catch (e) {
    // Nothing is marked, so a failed submit costs only this run.
    console.error(
      `[articles] batch submit failed: ${e instanceof Error ? e.message.slice(0, 300) : e} — retries next run`
    );
  }
}

/** Synchronous mode: generate now, one card per call. */
async function runSequential() {
  // A submitted batch holds cards that still have articleAt null, so this
  // mode would happily regenerate every one of them — paying twice and
  // racing the collection. There's no record of which cards a job contains,
  // so this can't be filtered out; warn instead and let the operator decide,
  // since a deliberate backlog drain is still a reasonable thing to do while
  // a small batch is pending.
  if (batchingAvailable()) {
    const pending = (await listBatches(BATCH_PREFIX)).filter((j) => {
      const s = j.state as string | undefined;
      return !s || (!BATCH_DONE_STATES.has(s) && !BATCH_TERMINAL_FAILURE_STATES.has(s));
    });
    if (pending.length > 0) {
      console.warn(
        `[articles] ! ${pending.length} article batch(es) still in flight (${pending
          .map((j) => j.displayName)
          .join(", ")}).\n` +
          "[articles] ! Those cards are also unmarked, so this run may regenerate them and pay twice.\n" +
          "[articles] ! Collect first with `tsx scripts/generate-articles.ts --batch`, or let this run proceed knowingly."
      );
    }
  }

  const { cards, remaining } = await selectCards(MAX_PER_RUN);
  console.log(`[articles] ${remaining} card(s) without an article; processing ${cards.length} this run.`);

  let written = 0;
  let short = 0;
  let failed = 0;

  for (const [i, c] of cards.entries()) {
    let result;
    try {
      result = await generateFor(c);
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

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    // Gemini-only by design (see generateFor) — no Groq fallback here.
    console.log("[articles] no GEMINI_API_KEY — skipping.");
    return;
  }

  // --batch is the deploy/ongoing path: half price, nothing waiting on it.
  // Bare invocation stays synchronous for backlog drains and manual runs
  // where someone wants articles now — same split as the content generator's
  // --top-up vs --category.
  if (process.argv.includes("--batch")) return runBatch();
  return runSequential();
}

main()
  .catch((e) => {
    console.error("[articles] fatal:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
