/**
 * Pre-generate Piper narration for published cards missing cached audio,
 * so first listens are instant. Runs in the background after the web
 * server is up (see scripts/start-prod.sh); safe to interrupt — whatever
 * is missed gets generated lazily on first listen or on the next deploy.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { audioCacheEnabled, hasCardAudio, getCardAudio } from "../src/lib/audio";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pause between cards and per-run ceiling: the backfill is deliberately slow
// and spread across deploys — narration must never contend with real traffic.
const PAUSE_MS = Number(process.env.PREGEN_PAUSE_MS) || 3_000;
const MAX_PER_RUN = Number(process.env.PREGEN_MAX_PER_RUN) || 150;

async function main() {
  if (!audioCacheEnabled()) {
    console.log("Audio pre-generation skipped (PIPER_URL and/or S3 not configured).");
    return;
  }

  // Only STANDARD cards: the feed narrates the standard row's id even when
  // a depth variant is showing, so DEEP/EXTRA_DEEP rows never get audio
  // requests — and the multi-paragraph ones blow the synthesis timeout.
  const cards = await prisma.card.findMany({
    where: { published: true, depthLevel: "STANDARD" },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, body: true },
  });

  let generated = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  for (const card of cards) {
    if (generated >= MAX_PER_RUN) {
      console.log(`Per-run ceiling of ${MAX_PER_RUN} reached — the rest continues next deploy.`);
      break;
    }
    if (await hasCardAudio(card.id)) continue;
    try {
      await getCardAudio(card.id, `${card.title}. ${card.body}`);
      generated++;
      consecutiveFailures = 0;
    } catch (e) {
      failed++;
      consecutiveFailures++;
      console.warn(`  ✗ ${card.id}: ${e instanceof Error ? e.message : e}`);
      // Only a run of back-to-back failures means Piper itself is down;
      // isolated slow cards shouldn't abort the whole sweep.
      if (consecutiveFailures >= 5) {
        console.warn("5 narration failures in a row — Piper looks down, stopping (retries next deploy).");
        break;
      }
    }
    await sleep(PAUSE_MS);
  }
  console.log(`Audio pre-generation done: ${generated} generated, ${failed} failed, ${cards.length} standard published cards.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
