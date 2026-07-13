import { prisma } from "@/lib/db";

export type RelatedLink = { id: string; title: string; icon: string };

// Below ~0.02 a "match" is usually a single shared generic lexeme — noise,
// not a connection. Cards with nothing above this simply show no trail.
const MIN_RANK = 0.02;

/**
 * Light-touch related cards via full-text similarity: the source card's
 * title lexemes (OR-ed into a tsquery) ranked against the other cards'
 * title+body vectors. Reuses the search GIN index; no AI cost.
 */
export async function getRelatedCards(
  cardIds: string[],
  perCard = 2
): Promise<Map<string, RelatedLink[]>> {
  const map = new Map<string, RelatedLink[]>();
  if (cardIds.length === 0) return map;

  const rows = await prisma.$queryRaw<
    { sourceId: string; id: string; title: string; icon: string }[]
  >`
    SELECT src.id AS "sourceId", r.id, r.title, r.icon
    FROM "Card" src
    CROSS JOIN LATERAL (
      SELECT to_tsquery('english', (
        SELECT string_agg(lex, ' | ')
        FROM unnest(tsvector_to_array(to_tsvector('english', src.title))) AS lex
        WHERE lex ~ '^[a-z0-9]+$'
      )) AS q
    ) tq
    CROSS JOIN LATERAL (
      SELECT c.id, c.title, cat.icon
      FROM "Card" c
      JOIN "Category" cat ON cat.id = c."categoryId"
      WHERE c.published
        AND c."depthLevel" = 'STANDARD'
        AND c.id <> src.id
        AND tq.q IS NOT NULL
        AND c."search" @@ tq.q
        AND ts_rank(c."search", tq.q) >= ${MIN_RANK}
      ORDER BY ts_rank(c."search", tq.q) DESC
      LIMIT ${perCard}
    ) r
    WHERE src.id = ANY(${cardIds})
  `;

  for (const row of rows) {
    const list = map.get(row.sourceId) ?? [];
    list.push({ id: row.id, title: row.title, icon: row.icon });
    map.set(row.sourceId, list);
  }
  return map;
}
