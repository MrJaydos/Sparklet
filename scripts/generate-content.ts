/**
 * AI card generation. Writes validated JSON to content/generated/<slug>/,
 * which the seed importer (scripts/seed-content.ts) picks up on the next
 * deploy — after re-checking every source URL.
 *
 * Modes:
 *   --all --count 30            seed run: 30 cards for every category
 *   --category space --count 10 one category
 *   --top-up                    inventory mode (used by the scheduled job):
 *                               reads $APP_URL/api/inventory and only tops up
 *                               categories under $MIN_BANK published cards
 *
 * No database access needed — safe to run from CI.
 */
import "dotenv/config";
import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { generateJSON } from "../src/lib/ai-provider";
import { cardSchema, type CardInput } from "../src/lib/content-schema";

const MIN_BANK = Number(process.env.MIN_BANK) || 40; // top-up threshold
const TOPUP_COUNT = Number(process.env.TOPUP_COUNT) || 10;

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
  language: "Etymology, linguistics and surprising word origins",
  philosophy: "Thought experiments, ethics and big ideas explained simply",
  code: "Programming, computer science and hacker lore",
};

const generatedCardSchema = cardSchema.omit({ category: true });

function buildPrompt(opts: {
  categoryName: string;
  categoryDescription: string;
  count: number;
  existingTitles: string[];
}) {
  const avoid = opts.existingTitles.length
    ? `\nAlready covered — do NOT repeat these topics:\n${opts.existingTitles.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `You write cards for Sparklet, a learning feed where every card must be factually accurate and verifiable. Generate ${opts.count} cards about ${opts.categoryName} (${opts.categoryDescription}).

Each card:
- "title": a hook under 100 characters. Surprising but never clickbait that overstates the fact.
- "body": 40-80 words. Plain, vivid prose. One self-contained idea a reader absorbs in 20 seconds. No markdown headings, no lists.
- "sources": 1-3 REAL sources as {"title", "publisher", "url"}. CRITICAL: only cite URLs you are certain exist. Strongly prefer stable pages: https://en.wikipedia.org/wiki/<Article_name>, major museums, NASA, .gov/.edu pages. NEVER invent a plausible-looking URL — if you are not sure the exact URL exists, use the relevant English Wikipedia article instead. Every URL will be automatically checked and the card is discarded if any link is dead.
- "readMoreUrl": the single best link for going deeper (may repeat a source URL).
- "imageWikipediaTitle": the exact English Wikipedia article title whose lead image best illustrates the card (e.g. "Octopus", "Ada Lovelace"). Omit if nothing fits.
- "type": "TEXT_IMAGE".

Accuracy rules: no urban legends presented as fact, no disputed claims stated flatly, numbers must match the cited source. If a fun "fact" is actually a myth, either skip it or make the card about the myth being false.
${avoid}

Respond with JSON only, shaped exactly as: {"cards": [ ... ]}`;
}

type InventoryCategory = {
  slug: string;
  name: string;
  description: string;
  publishedCount: number;
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

/** Parse model output, salvaging valid cards instead of all-or-nothing. */
function parseCards(text: string, slug: string): CardInput[] {
  const raw = JSON.parse(text) as { cards?: unknown[] };
  if (!Array.isArray(raw.cards)) throw new Error('missing "cards" array');
  const cards: CardInput[] = [];
  let dropped = 0;
  for (const item of raw.cards) {
    const result = generatedCardSchema.safeParse(item);
    if (result.success) cards.push({ ...result.data, category: slug });
    else dropped++;
  }
  if (dropped) console.warn(`  ! ${slug}: dropped ${dropped} card(s) that failed schema validation`);
  return cards;
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
    categoryName: target.name,
    categoryDescription: target.description,
    count: target.count,
    existingTitles: target.existingTitles,
  });

  // Two attempts: models occasionally emit malformed JSON.
  let cards: CardInput[] = [];
  let model = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generateJSON(prompt);
    model = result.model;
    try {
      cards = parseCards(result.text, target.slug);
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

  const dir = join(process.cwd(), "content", "generated", target.slug);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(
    file,
    JSON.stringify({ generatedAt: new Date().toISOString(), model, cards }, null, 2)
  );
  console.log(`  ✓ ${cards.length} card(s) → ${file} (${model})`);
  return { slug: target.slug, written: cards.length };
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
    targets = inventory
      .filter((c) => c.publishedCount < MIN_BANK)
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description,
        count,
        existingTitles: c.titles,
      }));
    console.log(
      targets.length
        ? `Top-up: ${targets.map((t) => `${t.slug}`).join(", ")} below ${MIN_BANK} published cards.`
        : `All categories have ≥ ${MIN_BANK} published cards — nothing to do.`
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
