import type { MapNode, MapEdge } from "@/lib/knowledge-map";

// Deterministic radial layout, not a force simulation: stable positions
// across reloads (good for screenshotting), no physics loop to run on a
// mobile battery budget. Same "hand-rolled inline SVG" pattern as XpRing.
const SIZE = 340;
const CENTER = SIZE / 2;
const INNER_RADIUS = 42;
const RING_GAP = 32;
const NODES_PER_RING = 6;

export function MapView({
  nodes,
  edges,
  totalLearned,
}: {
  nodes: MapNode[];
  edges: MapEdge[];
  totalLearned: number;
}) {
  const categoryOrder: string[] = [];
  const byCategory = new Map<string, MapNode[]>();
  for (const n of nodes) {
    if (!byCategory.has(n.category.slug)) {
      byCategory.set(n.category.slug, []);
      categoryOrder.push(n.category.slug);
    }
    byCategory.get(n.category.slug)!.push(n);
  }

  const angleStep = (2 * Math.PI) / Math.max(1, categoryOrder.length);
  const positions = new Map<string, { x: number; y: number; color: string }>();

  categoryOrder.forEach((slug, ci) => {
    const group = byCategory.get(slug)!;
    const baseAngle = ci * angleStep - Math.PI / 2; // 0th category starts at the top
    const spread = angleStep * 0.8; // leaves a gap between category slices
    group.forEach((node, i) => {
      const ring = Math.floor(i / NODES_PER_RING);
      const ringStart = ring * NODES_PER_RING;
      const posInRing = i - ringStart;
      const ringCount = Math.min(NODES_PER_RING, group.length - ringStart);
      const angle =
        baseAngle + (ringCount > 1 ? (posInRing / (ringCount - 1) - 0.5) * spread : 0);
      const radius = INNER_RADIUS + ring * RING_GAP;
      positions.set(node.id, {
        x: CENTER + radius * Math.cos(angle),
        y: CENTER + radius * Math.sin(angle),
        color: node.category.colorHex,
      });
    });
  });

  return (
    <div>
      <div className="text-center">
        <div className="text-4xl font-bold">{totalLearned}</div>
        <div className="mt-1 text-sm text-neutral-400">connected facts learned</div>
      </div>

      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto mt-4 block w-full max-w-sm"
        role="img"
        aria-label="Your knowledge map"
      >
        <g stroke="#525252" strokeWidth={1} opacity={0.35}>
          {edges.map((e, i) => {
            const a = positions.get(e.source);
            const b = positions.get(e.target);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </g>
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          return (
            <a key={n.id} href={`/card/${n.id}`}>
              <circle cx={p.x} cy={p.y} r={5} fill={p.color} stroke="#0a0a0a" strokeWidth={1.5} />
              <title>{n.title}</title>
            </a>
          );
        })}
      </svg>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {categoryOrder.map((slug) => {
          const group = byCategory.get(slug)!;
          const cat = group[0].category;
          return (
            <span
              key={slug}
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: `${cat.colorHex}33`, color: cat.colorHex }}
            >
              {cat.icon} {cat.name} · {group.length}
            </span>
          );
        })}
      </div>
    </div>
  );
}
