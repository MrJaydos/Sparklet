/**
 * Deploy-time enrichment: give already-published cards the interactive
 * extras newer generations ship with — a recall quiz for cards that have
 * none, and a guess-before-reveal challenge for cards whose core fact is a
 * number. Runs in the background after content import (scripts/start-prod.sh);
 * needs AI keys and degrades to a no-op without them.
 *
 * Card.enrichedAt marks cards as examined (whether or not anything was
 * produced) so each deploy only processes new work.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateJSON } from "../src/lib/ai-provider";
import { quizSchema, guessSchema } from "../src/lib/content-schema";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const BATCH_SIZE = 12; // cards per model call
// Per-run ceiling: enrichment shares the Gemini daily quota with generation,
// verification and live depth requests. Raised from 60 (5 model calls) now
// that the key has paid credit — still capped so a big backlog of unenriched
// cards can't eat the whole day's budget in one deploy.
const MAX_CARDS_PER_RUN = Number(process.env.ENRICH_MAX_PER_RUN) || 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildPrompt(cards: { title: string; body: string }[], needQuiz: boolean[]) {
  const list = cards
    .map((c, i) => `CARD ${i}${needQuiz[i] ? "" : " (already has a quiz — guesses only)"}:\nTITLE: ${c.title}\nBODY: ${c.body}`)
    .join("\n\n");

  return `These are published cards from Sparklet, a learning feed. For each card, produce interactive extras that test or preview its core fact. Never contradict the card text — every answer must come straight from it.

${list}

Produce "quizzes": one low-stakes multiple-choice question per card that is NOT marked "already has a quiz":
- "cardIndex": the CARD number it tests
- "question": one clear question under 200 characters
- "options": exactly 4 plausible answers (one correct)
- "correctIndex": 0-3
- "explanation": one line (under 300 chars) saying why the answer is right

Produce "guesses": for each card whose core fact is a striking NUMBER, a guess-before-reveal challenge answered on a slider BEFORE seeing the card:
- "cardIndex": the CARD number it previews
- "prompt": the question, phrased so someone who hasn't read the card can guess (under 200 chars). Do NOT give the answer away.
- "answer": the true number, exactly as the card states it
- "min"/"max": slider range. The answer must sit strictly inside it, never at an endpoint, and the range must be wide enough that guessing is genuinely uncertain (natural bounds like 0-100 for percentages are ideal).
- "unit": short display unit ("%", "km", "years", "" for plain counts)
- "explanation": one line of payoff context (under 300 chars)
Only create a guess when the number itself is the surprise — skip cards without one.

Respond with JSON only: {"quizzes": [ ... ], "guesses": [ ... ]}`;
}

async function enrichBatch(
  cards: { id: string; title: string; body: string; quizCount: number; guessCount: number }[]
): Promise<{ quizzes: number; guesses: number }> {
  const needQuiz = cards.map((c) => c.quizCount === 0);
  const needGuess = cards.map((c) => c.guessCount === 0);
  const { text } = await generateJSON(buildPrompt(cards, needQuiz));
  const raw = JSON.parse(text) as { quizzes?: unknown[]; guesses?: unknown[] };

  let quizzes = 0;
  for (const item of raw.quizzes ?? []) {
    const parsed = quizSchema.safeParse(item);
    if (!parsed.success) continue;
    const card = cards[parsed.data.cardIndex];
    if (!card || !needQuiz[parsed.data.cardIndex]) continue;
    if (parsed.data.correctIndex >= parsed.data.options.length) continue;
    await prisma.quizCard.create({
      data: {
        cardId: card.id,
        question: parsed.data.question,
        options: parsed.data.options,
        correctIndex: parsed.data.correctIndex,
        explanation: parsed.data.explanation,
      },
    });
    quizzes++;
  }

  let guesses = 0;
  for (const item of raw.guesses ?? []) {
    const parsed = guessSchema.safeParse(item);
    if (!parsed.success) continue;
    const card = cards[parsed.data.cardIndex];
    // A card revisited solely for a missing quiz (see the widened selection
    // in main()) may already have a guess from its first enrichment pass —
    // don't duplicate it.
    if (!card || !needGuess[parsed.data.cardIndex]) continue;
    await prisma.guessCard.create({
      data: {
        cardId: card.id,
        prompt: parsed.data.prompt,
        answer: parsed.data.answer,
        min: parsed.data.min,
        max: parsed.data.max,
        unit: parsed.data.unit,
        explanation: parsed.data.explanation,
      },
    });
    guesses++;
  }
  return { quizzes, guesses };
}

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    console.log("Card enrichment skipped (no AI keys configured).");
    return;
  }

  const cards = await prisma.card.findMany({
    where: {
      published: true,
      depthLevel: "STANDARD",
      // Never-examined cards, PLUS a backfill for cards examined before every
      // card required a quiz (due spaced-repetition reviews now render as a
      // question — see src/lib/feed.ts's reviewQuizzes) but came up empty —
      // e.g. an older generation run, or a model pass that just skipped one.
      OR: [{ enrichedAt: null }, { quizCards: { none: {} } }],
    },
    orderBy: { createdAt: "desc" },
    take: MAX_CARDS_PER_RUN,
    select: {
      id: true,
      title: true,
      body: true,
      _count: { select: { quizCards: true, guessCards: true } },
    },
  });
  if (cards.length === 0) {
    console.log("Card enrichment: nothing to do.");
    return;
  }
  console.log(`Card enrichment: examining ${cards.length} card(s)…`);

  let quizzes = 0;
  let guesses = 0;
  let failures = 0;
  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE).map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      quizCount: c._count.quizCards,
      guessCount: c._count.guessCards,
    }));
    try {
      const result = await enrichBatch(batch);
      quizzes += result.quizzes;
      guesses += result.guesses;
      // Examined — even cards that yielded nothing don't need another pass.
      await prisma.card.updateMany({
        where: { id: { in: batch.map((c) => c.id) } },
        data: { enrichedAt: new Date() },
      });
    } catch (e) {
      failures++;
      console.warn(`  ✗ batch failed: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      if (failures >= 3) {
        console.warn("Too many enrichment failures — stopping (will retry next deploy).");
        break;
      }
    }
    if (i + BATCH_SIZE < cards.length) await sleep(5_000);
  }
  console.log(`Card enrichment done: +${quizzes} quiz(zes), +${guesses} guess(es).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
