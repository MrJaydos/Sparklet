/**
 * AI card generation. Writes validated JSON to content/generated/<slug>/,
 * which the seed importer (scripts/seed-content.ts) picks up on the next
 * deploy — after re-checking every source URL.
 *
 * Modes:
 *   --all --count 30            seed run: 30 cards for every category
 *   --category space --count 10 one category
 *   --top-up                    inventory mode (used by the scheduled job):
 *                               reads $APP_URL/api/inventory and tops up
 *                               categories under their effective minimum —
 *                               $MIN_BANK, raised to (most active reader's
 *                               seen count + $TOPUP_HEADROOM) for categories
 *                               actually being read
 *
 * --top-up runs on Gemini batch mode when GEMINI_API_KEY is set (half
 * price, async — see runBatchTopUp): each scheduled run first collects
 * whatever batch the *previous* run submitted, writing its cards, then
 * submits one new batch covering tonight's low categories (skipped if a
 * batch is still in flight, so there's never more than one outstanding).
 * That means a category topped up tonight typically lands in the bank
 * ~24h later, not immediately — fine for a background bank, not for
 * anything latency-sensitive. --all/--category (a human waiting on
 * output) and top-up without a Gemini key stay on the old synchronous
 * per-category path.
 *
 * No database access needed — safe to run from CI.
 */
import "dotenv/config";
import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import {
  generateJSON,
  batchingAvailable,
  submitBatch,
  listBatches,
  getBatch,
  deleteBatch,
  batchResults,
  GEMINI_MODEL,
} from "../src/lib/ai-provider";
import {
  cardSchema,
  quizSchema,
  guessSchema,
  type CardInput,
  type QuizInput,
  type GuessInput,
} from "../src/lib/content-schema";

const MIN_BANK = Number(process.env.MIN_BANK) || 40; // base top-up threshold
const TOPUP_COUNT = Number(process.env.TOPUP_COUNT) || 10;
// Demand-aware floor: a category's effective minimum is raised to its most
// engaged recent reader's seen-count plus this buffer, so active readers
// always have unseen cards waiting even when the global bank looks full.
const TOPUP_HEADROOM = Number(process.env.TOPUP_HEADROOM) || 15;
// Cap categories per scheduled run so the day's Gemini usage (generation
// here + one cross-verify call per imported card at deploy) stays inside
// quota — otherwise the overflow lands on Groq, whose cards we'd rather
// keep to a minimum. Emptiest categories go first; the rest wait for
// tomorrow's run. Raised to cover every category (14, as of 2026-07-19)
// in one night now that the Gemini key has paid credit behind it — still
// capped, not unlimited, since generation + verification + live depth
// requests all draw from the same daily budget.
const TOPUP_MAX_CATEGORIES = Number(process.env.TOPUP_MAX_CATEGORIES) || 14;

// Categories the generator knows about even without inventory access.
// Kept in sync with prisma/seed.ts.
const FALLBACK_CATEGORIES: Record<string, string> = {
  science: "Physics, chemistry, biology and the scientific method",
  history: "Events, people and turning points that shaped the world",
  psychology: "How minds work — cognition, behavior, biases and mental health",
  tech: "Technology, engineering and the ideas behind the tools we use",
  culture: "Art, music, food, traditions and how humans express themselves",
  money: "Economics, personal finance and how value moves through the world",
  nature: "Animals, plants, ecosystems and the living world",
  space: "Astronomy, spaceflight and everything beyond the atmosphere",
  health: "Nutrition, sleep, exercise and how your body actually works",
  language:
    "Word origins and linguistics, plus everyday basics from world languages — greetings, counting and phrases, always written in the native script (こんにちは, 你好, مرحبا) alongside romanization and pronunciation",
  philosophy: "Thought experiments, ethics and big ideas explained simply",
  code: "Programming, computer science and hacker lore",
  sales:
    "Practical sales and persuasion tactics — small, evidence-backed techniques you can use in your next pitch, negotiation or conversation",
  fun: "Weird-but-true trivia and delightfully useless facts — the stranger the better. Famous 'facts' that are actually myths get busted, not repeated",
};

const generatedCardSchema = cardSchema.omit({ category: true });

// Extra per-category instructions appended to the prompt. The description
// alone is too weak for some requirements — spell them out as hard rules.
const CATEGORY_PROMPT_EXTRAS: Record<string, string> = {
  language: `
Language-specific rules:
- When a card teaches a word or phrase from another language, the body MUST include it in its native script — e.g. こんにちは (konnichiwa), 안녕하세요 (annyeonghaseyo), مرحبا (marhaban), 你好 (nǐ hǎo) — followed by romanization in parentheses and a plain-English pronunciation hint.
- NEVER leave empty parentheses or romanization-only where native script belongs. If you cannot produce the native script accurately, pick a different card topic instead.
- Roughly half the cards should teach practical basics (greetings, counting, please/thank-you, getting by); the rest can cover etymology and linguistics.`,
  fun: `
Fun & Weird rules:
- Every card should make someone say "wait, really?!" and want to tell a friend: absurd animal behavior, bizarre laws and historical moments, silly human quirks, delightfully useless facts (think: wombats have cubic poop; Scotland's national animal is the unicorn).
- This is NOT a records book — no "longest/tallest/largest/deepest X" superlative listings.
- Playful titles are welcome, but the fact itself must still be true and verifiable.
- If a famous fun "fact" is actually a myth (like cows being unable to walk down stairs), write the card busting the myth.`,
};

function buildPrompt(opts: {
  slug: string;
  categoryName: string;
  categoryDescription: string;
  count: number;
  existingTitles: string[];
}) {
  const avoid = opts.existingTitles.length
    ? `\nAlready covered — do NOT repeat these topics:\n${opts.existingTitles.map((t) => `- ${t}`).join("\n")}`
    : "";
  const extras = CATEGORY_PROMPT_EXTRAS[opts.slug] ?? "";

  return `You write cards for Sparklet, a learning feed where every card must be factually accurate and verifiable. Generate ${opts.count} cards about ${opts.categoryName} (${opts.categoryDescription}).

Each card:
- "title": a hook under 100 characters. Surprising but never clickbait that overstates the fact.
- "body": 40-80 words. Plain, vivid prose. One self-contained idea a reader absorbs in 20 seconds. No markdown headings, no lists.
- "sources": 1-3 REAL sources as {"title", "publisher", "url"}. CRITICAL: only cite URLs you are certain exist. Strongly prefer stable pages: https://en.wikipedia.org/wiki/<Article_name>, major museums, NASA, .gov/.edu pages. NEVER invent a plausible-looking URL — if you are not sure the exact URL exists, use the relevant English Wikipedia article instead. Every URL will be automatically checked and the card is discarded if any link is dead. NEVER cite a source that requires a paid subscription or institutional login to read in full — no NYT/WSJ/Bloomberg/FT/Economist/Washington Post, and no academic-journal publisher pages (ScienceDirect, SpringerLink, SAGE Journals, Wiley Online Library, JSTOR, IEEE Xplore, NEJM, The Lancet, APA PsycNet, etc.) — a reader must be able to open and read the whole source for free. Prefer Wikipedia, PubMed/PMC, open-access journals, .gov/.edu pages, or free-to-read news instead.
- "readMoreUrl": the single best link for going deeper (may repeat a source URL).
- "imageWikipediaTitle": the exact English Wikipedia article title whose lead image best illustrates the card (e.g. "Octopus", "Ada Lovelace"). Omit if nothing fits.
- "type": "TEXT_IMAGE".

Accuracy rules: no urban legends presented as fact, no disputed claims stated flatly, numbers must match the cited source. If a fun "fact" is actually a myth, either skip it or make the card about the myth being false.
${extras}${avoid}

Also produce "quizzes": for roughly half of your cards, a low-stakes multiple-choice question testing that card's core fact:
- "cardIndex": the 0-based index of the card it tests
- "question": one clear question under 200 characters
- "options": exactly 4 plausible answers (one correct)
- "correctIndex": 0-3
- "explanation": one line (under 300 chars) saying why the answer is right

Also produce "guesses": for each card whose core fact is a striking NUMBER, a guess-before-reveal challenge the reader answers on a slider BEFORE seeing the card:
- "cardIndex": the 0-based index of the card it previews
- "prompt": the question, phrased so someone who hasn't read the card can guess (under 200 chars). Do NOT give the answer away.
- "answer": the true number (must match the card and its source)
- "min"/"max": slider range. The answer must sit strictly inside it, never at an endpoint, and the range must be wide enough that guessing is genuinely uncertain (typically answer ± several times itself, or the natural bounds like 0-100 for percentages).
- "unit": short display unit ("%", "km", "years", "" for plain counts)
- "explanation": one line of payoff context (under 300 chars)
Only create a guess when the number itself is the surprise — skip cards without one.

Respond with JSON only, shaped exactly as: {"cards": [ ... ], "quizzes": [ ... ], "guesses": [ ... ]}`;
}

type InventoryCategory = {
  slug: string;
  name: string;
  description: string;
  publishedCount: number;
  groqPublished: number; // fallback-provider cards, treated as replaceable
  maxSeen: number; // most cards any recently-active user has completed here
  titles: string[];
};

async function fetchInventory(): Promise<InventoryCategory[] | null> {
  const base = process.env.APP_URL;
  if (!base) return null;
  // Retry across a few minutes: the app 404s briefly mid-deploy, and a
  // scheduled run colliding with a deploy shouldn't kill the day's top-up.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/inventory`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.categories as InventoryCategory[];
    } catch (e) {
      console.warn(`Inventory fetch attempt ${attempt}/5 failed: ${e}`);
      if (attempt < 5) await sleep(45_000);
    }
  }
  return null;
}

/** Titles already in local content files, as a dedupe hint when there's no inventory. */
async function localTitles(slug: string): Promise<string[]> {
  const titles: string[] = [];
  for (const dir of ["curated", join("generated", slug)]) {
    const full = join(process.cwd(), "content", dir);
    let files: string[] = [];
    try {
      files = (await readdir(full)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const parsed = JSON.parse(await readFile(join(full, f), "utf8"));
        for (const c of parsed.cards ?? []) {
          if (dir === "curated" ? c.category === slug : true) titles.push(c.title);
        }
      } catch {
        /* skip unreadable file */
      }
    }
  }
  return titles;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse model output, salvaging valid cards/quizzes/guesses instead of all-or-nothing. */
function parseCards(
  text: string,
  slug: string
): { cards: CardInput[]; quizzes: QuizInput[]; guesses: GuessInput[] } {
  const raw = JSON.parse(text) as { cards?: unknown[]; quizzes?: unknown[]; guesses?: unknown[] };
  if (!Array.isArray(raw.cards)) throw new Error('missing "cards" array');
  const cards: CardInput[] = [];
  // Map original card index -> index in the salvaged array, so quiz links
  // survive dropped cards.
  const indexMap = new Map<number, number>();
  let dropped = 0;
  raw.cards.forEach((item, i) => {
    const result = generatedCardSchema.safeParse(item);
    if (result.success) {
      indexMap.set(i, cards.length);
      cards.push({ ...result.data, category: slug });
    } else dropped++;
  });
  if (dropped) console.warn(`  ! ${slug}: dropped ${dropped} card(s) that failed schema validation`);

  const quizzes: QuizInput[] = [];
  for (const item of raw.quizzes ?? []) {
    const result = quizSchema.safeParse(item);
    if (!result.success) continue;
    const mapped = indexMap.get(result.data.cardIndex);
    if (mapped === undefined || result.data.correctIndex >= result.data.options.length) continue;
    quizzes.push({ ...result.data, cardIndex: mapped });
  }

  const guesses: GuessInput[] = [];
  for (const item of raw.guesses ?? []) {
    const result = guessSchema.safeParse(item);
    if (!result.success) continue;
    const mapped = indexMap.get(result.data.cardIndex);
    if (mapped === undefined) continue;
    guesses.push({ ...result.data, cardIndex: mapped });
  }
  return { cards, quizzes, guesses };
}

async function writeGeneratedFile(
  slug: string,
  model: string,
  cards: CardInput[],
  quizzes: QuizInput[],
  guesses: GuessInput[]
) {
  const dir = join(process.cwd(), "content", "generated", slug);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(
    file,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), model, cards, quizzes, guesses },
      null,
      2
    )
  );
  return file;
}

async function generateForCategory(target: {
  slug: string;
  name: string;
  description: string;
  count: number;
  existingTitles: string[];
}) {
  console.log(`\n▶ ${target.slug}: generating ${target.count} card(s)…`);
  const prompt = buildPrompt({
    slug: target.slug,
    categoryName: target.name,
    categoryDescription: target.description,
    count: target.count,
    existingTitles: target.existingTitles,
  });

  // Two attempts: models occasionally emit malformed JSON.
  let cards: CardInput[] = [];
  let quizzes: QuizInput[] = [];
  let guesses: GuessInput[] = [];
  let model = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generateJSON(prompt);
    model = result.model;
    try {
      ({ cards, quizzes, guesses } = parseCards(result.text, target.slug));
      if (cards.length > 0) break;
      throw new Error("no valid cards in response");
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
      if (attempt < 2) {
        console.warn(`  ! ${target.slug}: bad model output (${msg}) — retrying once`);
        await sleep(5_000);
      } else {
        console.error(`  ✗ ${target.slug}: bad model output after retry (${msg}) — skipping`);
        return { slug: target.slug, written: 0 };
      }
    }
  }

  const file = await writeGeneratedFile(target.slug, model, cards, quizzes, guesses);
  console.log(
    `  ✓ ${cards.length} card(s) + ${quizzes.length} quiz(zes) + ${guesses.length} guess(es) → ${file} (${model})`
  );
  return { slug: target.slug, written: cards.length };
}

const BATCH_PREFIX = "sparklet-topup-";
const BATCH_DONE_STATES = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_PARTIALLY_SUCCEEDED"]);
// Only these are known-terminal-and-unrecoverable — safe to delete.
// Anything else (PENDING/QUEUED/RUNNING/CANCELLING/UPDATING/PAUSED, or an
// unrecognized future state) is treated as still-working: leave it alone
// and skip submitting a new one tonight so we never have two in flight.
const BATCH_TERMINAL_FAILURE_STATES = new Set(["JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"]);

/**
 * Nightly top-up via Gemini batch mode (~half price, async). Collects any
 * batch submitted by a previous run, then — if nothing is still in
 * flight — submits one new batch covering `targets` minus whatever this
 * run just collected (those cards aren't imported yet, but they exist —
 * resubmitting them too would double-generate and erase the cost saving;
 * fetchInventory will still see a category as low next cycle if the
 * collected batch alone wasn't enough). Whatever a batch doesn't finish
 * (still running, or failed) is simply picked up again by tomorrow's run.
 */
async function runBatchTopUp(
  targets: { slug: string; name: string; description: string; count: number; existingTitles: string[] }[]
) {
  const jobs = await listBatches(BATCH_PREFIX);
  let inFlight = false;
  let written = 0;
  let hardFailure = false;
  const failed: string[] = [];
  const collectedSlugs = new Set<string>();

  for (const job of jobs) {
    const state = job.state as string | undefined;
    if (state && BATCH_DONE_STATES.has(state)) {
      console.log(`\n▶ Collecting batch ${job.displayName} (${state})…`);
      // batches.list() only returns summaries (state, displayName) — the
      // actual dest.inlinedResponses only comes back from batches.get() on
      // this specific job. Re-fetch before reading results; skipping this
      // silently "collects" zero cards from a job that actually succeeded.
      const full = job.name ? await getBatch(job.name) : null;
      const results = full ? batchResults(full) : [];
      // Either the get() failed to return real output, or metadata.key
      // (how we attribute a result back to a category) isn't being echoed.
      // Both mean this batch's cards can't be salvaged. Fail loudly (and
      // non-zero-exit) instead of folding into the ordinary "nothing to
      // collect" case, so this can't bleed quota silently, cycle after
      // cycle, with CI staying green throughout.
      if (results.length === 0 || results.every((r) => !r.key)) {
        console.error(
          `\n✗✗ Batch ${job.displayName}: ${results.length === 0 ? "batches.get() returned no results for a job in a done state" : `none of ${results.length} result(s) carried a metadata.key`} — cannot recover this batch's cards. Discarding it; investigate the batch API integration.`
        );
        // Diagnostic dump before the delete, in case this canary is itself
        // wrong about what get() returned — a deleted job leaves no other
        // way to see what actually came back.
        console.error(`  full job dump: ${JSON.stringify(full)}`);
        hardFailure = true;
        if (job.name) await deleteBatch(job.name);
        continue;
      }
      for (const { key: slug, text, error, finishReason } of results) {
        if (!slug) continue;
        if (!text) {
          console.warn(
            `  ✗ ${slug}: batch item failed (${error}${finishReason ? `, finishReason=${finishReason}` : ""}) — will retry next run`
          );
          failed.push(slug);
          continue;
        }
        try {
          const { cards, quizzes, guesses } = parseCards(text, slug);
          if (cards.length === 0) throw new Error("no valid cards in response");
          await writeGeneratedFile(slug, GEMINI_MODEL, cards, quizzes, guesses);
          written += cards.length;
          collectedSlugs.add(slug);
          console.log(
            `  ✓ ${slug}: ${cards.length} card(s) + ${quizzes.length} quiz(zes) + ${guesses.length} guess(es)`
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
          console.warn(`  ✗ ${slug}: bad batch output (${msg}) — will retry next run`);
          failed.push(slug);
        }
      }
      if (job.name) await deleteBatch(job.name);
    } else if (state && BATCH_TERMINAL_FAILURE_STATES.has(state)) {
      console.warn(`\n! Batch ${job.displayName} ended in ${state} — discarding, will retry next run`);
      if (job.name) await deleteBatch(job.name);
    } else {
      console.log(`\n… Batch ${job.displayName} still ${state ?? "unknown"} — leaving it, skipping submission tonight`);
      inFlight = true;
    }
  }

  const toSubmit = targets.filter((t) => !collectedSlugs.has(t.slug));

  if (!inFlight && toSubmit.length > 0) {
    const displayName = `${BATCH_PREFIX}${new Date().toISOString().slice(0, 10)}`;
    const requests = toSubmit.map((t) => ({
      key: t.slug,
      prompt: buildPrompt({
        slug: t.slug,
        categoryName: t.name,
        categoryDescription: t.description,
        count: t.count,
        existingTitles: t.existingTitles,
      }),
    }));
    try {
      const batchName = await submitBatch(requests, displayName);
      console.log(
        `\n▶ Submitted batch ${batchName} (${displayName}) for ${toSubmit.length} categor${toSubmit.length === 1 ? "y" : "ies"}: ${toSubmit.map((t) => t.slug).join(", ")}`
      );
    } catch (e) {
      console.error(`\n✗ Batch submit failed: ${e instanceof Error ? e.message.slice(0, 300) : e} — will retry next run`);
      // Only a hard (non-zero-exit) failure when this run produced nothing
      // at all — a submit failure right after a successful collection is
      // still a net-positive run and shouldn't turn the workflow red.
      if (written === 0) hardFailure = true;
    }
  } else if (!inFlight) {
    console.log("\nNo categories under threshold (after excluding what this run just collected) — nothing new to submit.");
  }

  console.log(
    written || failed.length
      ? `\nCollected ${written} card(s) this run${failed.length ? `; ${failed.length} categor${failed.length === 1 ? "y" : "ies"} will retry next run: ${failed.join(", ")}` : ""}.`
      : "\nNothing to collect this run."
  );
  // The commit step runs regardless (if: always()) so any content collected
  // above is never lost — this only marks the Actions run itself as failed
  // so a broken batch API contract shows up as a red X, not silent drift.
  if (hardFailure) process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const getFlag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const topUp = args.includes("--top-up");
  const all = args.includes("--all");
  const categoryArg = getFlag("category");
  const count = Number(getFlag("count")) || (topUp ? TOPUP_COUNT : 20);

  const inventory = await fetchInventory();

  let targets: { slug: string; name: string; description: string; count: number; existingTitles: string[] }[] = [];

  if (topUp) {
    if (!inventory) {
      console.error("--top-up requires APP_URL pointing at a running Sparklet instance.");
      process.exit(1);
    }
    // Effective minimum per category: the global floor, raised for categories
    // being actively read so the fastest reader keeps TOPUP_HEADROOM unseen
    // cards ahead of them. Fallback-provider (Groq) cards don't count toward
    // the bank — they're placeholders awaiting Gemini replacements, which the
    // deploy-time importer retires once the bank allows. Most-starved
    // categories go first.
    const low = inventory
      .map((c) => ({
        ...c,
        need: Math.max(MIN_BANK, (c.maxSeen ?? 0) + TOPUP_HEADROOM),
        quality: c.publishedCount - (c.groqPublished ?? 0),
      }))
      .filter((c) => c.quality < c.need)
      .sort((a, b) => (b.need - b.quality) - (a.need - a.quality));
    targets = low.slice(0, TOPUP_MAX_CATEGORIES).map((c) => ({
      slug: c.slug,
      name: c.name,
      description: c.description,
      count,
      existingTitles: c.titles,
    }));
    console.log(
      low.length
        ? `Top-up: ${low
            .slice(0, TOPUP_MAX_CATEGORIES)
            .map((c) => {
              const notes = [
                c.need > MIN_BANK ? `demand-raised: top reader at ${c.maxSeen}` : "",
                c.groqPublished > 0 ? `${c.groqPublished} groq card(s) to replace` : "",
              ].filter(Boolean);
              return `${c.slug} (${c.quality}/${c.need}${notes.length ? `, ${notes.join(", ")}` : ""})`;
            })
            .join(", ")}.` +
            (low.length > targets.length
              ? ` (${low.length - targets.length} more deferred to stay inside the Gemini daily quota.)`
              : "")
        : `All categories meet their bank minimums with non-fallback cards (base ${MIN_BANK}, +${TOPUP_HEADROOM} headroom over the most active reader) — nothing to do.`
    );
  } else {
    const slugs = all
      ? Object.keys(FALLBACK_CATEGORIES)
      : categoryArg?.split(",").filter(Boolean) ?? [];
    if (!slugs.length) {
      console.error("Usage: generate-content.ts [--all | --category slug[,slug] | --top-up] [--count N]");
      process.exit(1);
    }
    for (const slug of slugs) {
      const inv = inventory?.find((c) => c.slug === slug);
      const description = inv?.description ?? FALLBACK_CATEGORIES[slug];
      if (!description) {
        console.error(`Unknown category "${slug}"`);
        process.exit(1);
      }
      targets.push({
        slug,
        name: inv?.name ?? slug,
        description,
        count,
        existingTitles: inv?.titles ?? (await localTitles(slug)),
      });
    }
  }

  // Top-up is the only caller patient enough to wait on batch mode's async
  // turnaround (--all/--category are run by a human waiting on output).
  if (topUp && batchingAvailable()) {
    await runBatchTopUp(targets);
    return;
  }

  let total = 0;
  const failed: string[] = [];
  for (const [i, target] of targets.entries()) {
    try {
      const { written } = await generateForCategory(target);
      total += written;
      if (written === 0) failed.push(target.slug);
    } catch (e) {
      // One category failing must not lose the others' output.
      console.error(`  ✗ ${target.slug}: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
      failed.push(target.slug);
    }
    // Pace requests — the free tier rate-limits bursts.
    if (i < targets.length - 1) await sleep(10_000);
  }

  console.log(
    `\nDone: ${total} card(s) written across ${targets.length - failed.length}/${targets.length} categor${targets.length === 1 ? "y" : "ies"}.`
  );
  if (failed.length) {
    console.warn(`Failed categories (will be retried by the next scheduled run): ${failed.join(", ")}`);
  }
  // Only fail the job when nothing at all was produced, so partial output
  // still gets committed by CI.
  if (targets.length > 0 && total === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
