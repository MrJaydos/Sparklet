export type LayoutPos = { x: number; y: number };

/**
 * Fruchterman-Reingold force-directed layout: nodes repel each other,
 * connected nodes attract along edges, a cooling "temperature" settles the
 * system into a stable layout — organic clustering instead of a fixed
 * geometric arrangement. Dependency-free (no d3-force), and runs once at
 * render time rather than as a live physics loop, so there's no ongoing
 * simulation shipped to the client.
 *
 * Node positions are deterministically seeded from a hash of their id, so
 * the same graph settles into the same layout across reloads (important
 * for the screenshot-bait use case — a map that reshuffles every visit
 * isn't something you'd want to share).
 */
export function forceLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  opts?: { width?: number; height?: number; iterations?: number }
): Map<string, LayoutPos> {
  const width = opts?.width ?? 600;
  const height = opts?.height ?? 600;
  const iterations = opts?.iterations ?? 200;
  const n = nodeIds.length;
  const pos = new Map<string, LayoutPos>();
  if (n === 0) return pos;

  const hash = (str: string) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  };

  const cx = width / 2;
  const cy = height / 2;
  nodeIds.forEach((id) => {
    const h = hash(id);
    const angle = ((h % 3600) / 3600) * 2 * Math.PI;
    const radius = (h % Math.floor(Math.min(width, height) / 3)) + 20;
    pos.set(id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  // Ideal edge length — the classic Fruchterman-Reingold constant. Kept
  // fairly tight: disconnected components (topics with no keyword overlap)
  // have nothing pulling them together, so a looser constant leaves huge
  // empty gaps between clusters instead of a compact, frame-filling graph.
  const k = Math.sqrt((width * height) / n) * 0.7;
  let temperature = Math.max(width, height) * 0.1;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, LayoutPos>();
    nodeIds.forEach((id) => disp.set(id, { x: 0, y: 0 }));

    // Repulsion between every pair — fine for the graph sizes this renders
    // (a few dozen nodes), not meant to scale to thousands.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodeIds[i])!;
        const b = pos.get(nodeIds[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        const da = disp.get(nodeIds[i])!;
        const db = disp.get(nodeIds[j])!;
        da.x += dx;
        da.y += dy;
        db.x -= dx;
        db.y -= dy;
      }
    }

    // Attraction along edges, pulling connected nodes together.
    for (const { source, target } of edges) {
      const a = pos.get(source);
      const b = pos.get(target);
      if (!a || !b) continue;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const force = (dist * dist) / k;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      const da = disp.get(source)!;
      const db = disp.get(target)!;
      da.x -= dx;
      da.y -= dy;
      db.x += dx;
      db.y += dy;
    }

    nodeIds.forEach((id) => {
      const p = pos.get(id)!;
      const d = disp.get(id)!;
      const dlen = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y));
      const capped = Math.min(dlen, temperature);
      p.x += (d.x / dlen) * capped;
      p.y += (d.y / dlen) * capped;
      // Pull toward center — strong enough that separate components
      // (topics with no keyword overlap) stay packed into one compact
      // graph instead of repulsion alone scattering them across a mostly
      // empty canvas.
      p.x += (cx - p.x) * 0.02;
      p.y += (cy - p.y) * 0.02;
    });

    temperature *= 0.985; // simulated-annealing cooldown
  }

  return pos;
}
