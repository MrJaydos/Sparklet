import type { MapNode, MapEdge } from "@/lib/knowledge-map";
import { forceLayout } from "@/lib/force-layout";

const LAYOUT_SIZE = 600; // working coordinate space the simulation runs in
const PADDING = 24; // margin around the settled graph inside the viewBox

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

  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const positions = forceLayout(
    nodes.map((n) => n.id),
    edges,
    { width: LAYOUT_SIZE, height: LAYOUT_SIZE, iterations: 220 }
  );

  // Fit the viewBox to however the graph actually settled — an organic,
  // asymmetric shape, not a fixed square — rather than cropping or wasting
  // space around a layout whose extent isn't known ahead of time.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = LAYOUT_SIZE;
    maxY = LAYOUT_SIZE;
  }
  const viewX = minX - PADDING;
  const viewY = minY - PADDING;
  const viewW = maxX - minX + PADDING * 2;
  const viewH = maxY - minY + PADDING * 2;

  const radiusFor = (id: string) => Math.min(14, 4 + (degree.get(id) ?? 0) * 1.8);

  return (
    <div>
      <div className="text-center">
        <div className="text-4xl font-bold">{totalLearned}</div>
        <div className="mt-1 text-sm text-neutral-400">facts learned overall</div>
        <div className="mt-3 text-xs text-neutral-500">
          Your most recent {nodes.length}, connected below
        </div>
      </div>

      <svg
        viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
        className="mx-auto mt-4 block w-full"
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
              <circle
                cx={p.x}
                cy={p.y}
                r={radiusFor(n.id)}
                fill={n.category.colorHex}
                stroke="#0a0a0a"
                strokeWidth={1.5}
              />
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
