/**
 * One-off repair: rewrite stored source publishers so each matches its URL.
 *
 * Cards imported before source normalization carry hallucinated attributions
 * — "NASA", "Rijksmuseum", "Credit Suisse", "Château de Versailles" on links
 * that all point at en.wikipedia.org — and that string is what the source
 * chip shows the reader. Idempotent: re-running touches nothing once clean,
 * so it is safe to leave wired into the deploy.
 *
 * Renders are normalized defensively too (card page + feed), so this only
 * fixes the data at rest; it is not what keeps the UI honest.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  normalizeSources,
  isMisattributed,
  type StoredSource,
} from "../src/lib/source-attribution";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const cards = await prisma.card.findMany({ select: { id: true, sources: true } });

  let scanned = 0;
  let fixed = 0;
  let badLabels = 0;

  for (const card of cards) {
    const sources = card.sources as StoredSource[] | null;
    if (!Array.isArray(sources) || sources.length === 0) continue;
    scanned++;

    const offending = sources.filter(isMisattributed);
    if (offending.length === 0) continue;

    badLabels += offending.length;
    await prisma.card.update({
      where: { id: card.id },
      data: { sources: normalizeSources(sources) },
    });
    fixed++;
  }

  console.log(
    `[attribution] scanned ${scanned} card(s); rewrote ${badLabels} misattributed source label(s) across ${fixed} card(s).`
  );
}

main()
  .catch((e) => {
    console.error("[attribution] fatal:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
