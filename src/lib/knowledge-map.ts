import { prisma } from "@/lib/db";
import { getRelatedCards } from "@/lib/related";

export type MapNode = {
  id: string;
  title: string;
  category: { slug: string; name: string; colorHex: string; icon: string };
};

export type MapEdge = { source: string; target: string };

// Bounded to the user's most recent history rather than their entire
// completed set — matches the profile page's existing HistoryList query, and
// keeps getRelatedCards' per-request GIN-index probes to a small, cheap
// batch rather than hundreds of lookups on an occasional page view.
const NODE_LIMIT = 50;
const EDGES_PER_NODE = 3;

/**
 * Nodes = cards the user has completed (bounded to their most recent 50).
 * Edges = related.ts's title-similarity links, filtered to only connect
 * facts the user has actually learned — related.ts's target pool is any
 * published card, so without this filter edges would point at things the
 * user has never read, breaking the "connected facts you know" premise.
 */
export async function getKnowledgeMap(userId: string): Promise<{
  nodes: MapNode[];
  edges: MapEdge[];
  totalLearned: number;
}> {
  const [completed, totalLearned] = await Promise.all([
    prisma.userCardInteraction.findMany({
      where: { userId, completed: true },
      orderBy: { viewedAt: "desc" },
      take: NODE_LIMIT,
      select: {
        card: {
          select: {
            id: true,
            title: true,
            category: { select: { slug: true, name: true, colorHex: true, icon: true } },
          },
        },
      },
    }),
    prisma.userCardInteraction.count({ where: { userId, completed: true } }),
  ]);

  const nodes: MapNode[] = completed.map((c) => c.card);
  const nodeIds = new Set(nodes.map((n) => n.id));

  const rel = await getRelatedCards(nodes.map((n) => n.id), EDGES_PER_NODE);
  const edges: MapEdge[] = [];
  const seenPairs = new Set<string>(); // dedupe A-B/B-A into one rendered edge
  for (const [sourceId, links] of rel) {
    for (const link of links) {
      if (!nodeIds.has(link.id)) continue;
      const key = [sourceId, link.id].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      edges.push({ source: sourceId, target: link.id });
    }
  }

  return { nodes, edges, totalLearned };
}
