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

async function main() {
  if (!audioCacheEnabled()) {
    console.log("Audio pre-generation skipped (PIPER_URL and/or S3 not configured).");
    return;
  }

  const cards = await prisma.card.findMany({
    where: { published: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, body: true },
  });

  let generated = 0;
  let failed = 0;
  for (const card of cards) {
    if (await hasCardAudio(card.id)) continue;
    try {
      await getCardAudio(card.id, `${card.title}. ${card.body}`);
      generated++;
    } catch (e) {
      failed++;
      console.warn(`  ✗ ${card.id}: ${e instanceof Error ? e.message : e}`);
      if (failed >= 5) {
        console.warn("Too many narration failures — stopping (will retry next deploy).");
        break;
      }
    }
    // Keep the box breathable — this shares CPU with the live app.
    await sleep(500);
  }
  console.log(`Audio pre-generation done: ${generated} generated, ${failed} failed, ${cards.length} total published cards.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
