"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapNode, MapEdge } from "@/lib/knowledge-map";

const PADDING = 24; // margin around the settled graph inside the viewBox
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const DRAG_THRESHOLD = 4; // px — below this, a pointer gesture counts as a tap

// Live physics tuning — a continuous, velocity-based variant of the same
// repel/spring/center forces force-layout.ts uses for the one-shot initial
// layout. Dormant at rest (no idle jiggle burning battery); wakes only when
// a node is actually dragged, so touching the graph is what makes it feel
// alive rather than a constant animation.
const DAMPING = 0.82;
const SLEEP_SPEED = 0.02; // px/frame below which the sim goes back to sleep
const REPEL = 14000;
const SPRING = 0.02;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function MapView({
  nodes,
  edges,
  totalLearned,
  positions: positionList,
}: {
  nodes: MapNode[];
  edges: MapEdge[];
  totalLearned: number;
  /** Pre-computed by forceLayout() server-side — see src/app/map/page.tsx. */
  positions: { id: string; x: number; y: number }[];
}) {
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

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
  const radiusFor = (id: string) => Math.min(14, 4 + (degree.get(id) ?? 0) * 1.8);

  // Fit the viewBox to the graph's initial settled shape — an organic,
  // asymmetric extent, not a fixed square. Stays fixed even as live physics
  // nudges nodes around; a strong-enough center pull keeps things from
  // drifting off it (see the physics step below).
  const { viewX, viewY, viewW, viewH, centerX, centerY } = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positionList) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 600;
      maxY = 600;
    }
    return {
      viewX: minX - PADDING,
      viewY: minY - PADDING,
      viewW: maxX - minX + PADDING * 2,
      viewH: maxY - minY + PADDING * 2,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }, [positionList]);

  // Live simulation state lives in refs, not React state — positions get
  // written straight to the DOM every animation frame (60fps setState would
  // mean 60 renders/sec of the whole node/edge list for no benefit).
  const simRef = useRef<{
    pos: Map<string, { x: number; y: number; vx: number; vy: number }>;
    dragging: string | null;
  }>(null!);
  if (simRef.current == null) {
    simRef.current = {
      pos: new Map(positionList.map((p) => [p.id, { x: p.x, y: p.y, vx: 0, vy: 0 }])),
      dragging: null,
    };
  }
  const circleRefs = useRef<Map<string, SVGCircleElement>>(new Map());
  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const applyPositions = () => {
    for (const [id, el] of circleRefs.current) {
      const p = simRef.current.pos.get(id);
      if (p) {
        el.setAttribute("cx", String(p.x));
        el.setAttribute("cy", String(p.y));
      }
    }
    edges.forEach((e, i) => {
      const el = lineRefs.current[i];
      const a = simRef.current.pos.get(e.source);
      const b = simRef.current.pos.get(e.target);
      if (el && a && b) {
        el.setAttribute("x1", String(a.x));
        el.setAttribute("y1", String(a.y));
        el.setAttribute("x2", String(b.x));
        el.setAttribute("y2", String(b.y));
      }
    });
  };

  // Set initial positions once on mount (imperatively — cx/cy are never
  // React-controlled props, so a later re-render for pan/zoom/preview state
  // can't stomp on the live physics by resetting them to their original prop
  // values).
  useEffect(() => {
    applyPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = () => {
    const ids = [...simRef.current.pos.keys()];
    const pos = simRef.current.pos;
    const forces = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!;
        const b = pos.get(ids[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.max(8, Math.hypot(dx, dy));
        const f = REPEL / (dist * dist);
        dx = (dx / dist) * f;
        dy = (dy / dist) * f;
        forces.get(ids[i])!.x += dx;
        forces.get(ids[i])!.y += dy;
        forces.get(ids[j])!.x -= dx;
        forces.get(ids[j])!.y -= dy;
      }
    }

    const restLength = Math.sqrt((viewW * viewH) / Math.max(1, ids.length)) * 0.7;
    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.max(0.01, Math.hypot(dx, dy));
      const f = SPRING * (dist - restLength);
      dx = (dx / dist) * f;
      dy = (dy / dist) * f;
      forces.get(e.source)!.x += dx;
      forces.get(e.source)!.y += dy;
      forces.get(e.target)!.x -= dx;
      forces.get(e.target)!.y -= dy;
    }

    let maxSpeed = 0;
    for (const id of ids) {
      if (id === simRef.current.dragging) continue; // pinned to the pointer
      const p = pos.get(id)!;
      const f = forces.get(id)!;
      f.x += (centerX - p.x) * 0.01;
      f.y += (centerY - p.y) * 0.01;
      p.vx = (p.vx + f.x) * DAMPING;
      p.vy = (p.vy + f.y) * DAMPING;
      p.x += p.vx;
      p.y += p.vy;
      maxSpeed = Math.max(maxSpeed, Math.abs(p.vx), Math.abs(p.vy));
    }

    applyPositions();
    return maxSpeed;
  };

  const tick = () => {
    const maxSpeed = step();
    if (maxSpeed > SLEEP_SPEED || simRef.current.dragging) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null; // back to sleep until something disturbs it
    }
  };

  const wake = () => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Pan/zoom is a CSS transform on the <svg> itself, applied in screen-pixel
  // space — pointer deltas map 1:1 to translate() without needing to convert
  // through the viewBox's user-unit scale. Dragging a node instead (see
  // onPointerDown) drags that node's position within the physics sim.
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [previewNode, setPreviewNode] = useState<MapNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(
    null
  );
  const nodeDragRef = useRef<{ pointerId: number; nodeId: string; lastX: number; lastY: number } | null>(
    null
  );
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const nodeId = (e.target as Element).getAttribute?.("data-node-id");
    if (nodeId && pointersRef.current.size === 1) {
      simRef.current.dragging = nodeId;
      nodeDragRef.current = { pointerId: e.pointerId, nodeId, lastX: e.clientX, lastY: e.clientY };
      dragRef.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y, moved: false };
      wake();
      return;
    }
    if (pointersRef.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y, moved: false };
    } else if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      pinchRef.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: transform.scale,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const nodeDrag = nodeDragRef.current;
    if (nodeDrag && nodeDrag.pointerId === e.pointerId) {
      const dxScreen = e.clientX - nodeDrag.lastX;
      const dyScreen = e.clientY - nodeDrag.lastY;
      nodeDrag.lastX = e.clientX;
      nodeDrag.lastY = e.clientY;
      if (dragRef.current && Math.hypot(e.clientX - dragRef.current.x, e.clientY - dragRef.current.y) > DRAG_THRESHOLD) {
        dragRef.current.moved = true;
      }
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        const pxPerUnitX = rect.width / viewW;
        const pxPerUnitY = rect.height / viewH;
        const p = simRef.current.pos.get(nodeDrag.nodeId);
        if (p) {
          p.x += dxScreen / pxPerUnitX;
          p.y += dyScreen / pxPerUnitY;
          p.vx = 0;
          p.vy = 0;
        }
      }
      wake();
      return;
    }

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const nextScale = clamp(pinchRef.current.scale * (dist / pinchRef.current.dist), MIN_SCALE, MAX_SCALE);
      setTransform((t) => ({ ...t, scale: nextScale }));
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.moved = true;
    setTransform((t) => ({ ...t, x: drag.tx + dx, y: drag.ty + dy }));
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag && nodeDrag.pointerId === e.pointerId) {
      const wasTap = !dragRef.current?.moved;
      simRef.current.dragging = null;
      nodeDragRef.current = null;
      pointersRef.current.delete(e.pointerId);
      dragRef.current = null;
      wake(); // let the released node spring back into equilibrium
      if (wasTap) {
        const node = nodesById.get(nodeDrag.nodeId);
        if (node) setPreviewNode(node);
      }
      return;
    }

    const wasTap = pointersRef.current.size === 1 && dragRef.current && !dragRef.current.moved;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (wasTap) {
      const nodeId = (e.target as Element).getAttribute?.("data-node-id");
      if (nodeId) {
        const node = nodesById.get(nodeId);
        if (node) setPreviewNode(node);
      }
    }
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  // Wheel zoom needs a non-passive native listener — React's synthetic
  // onWheel is attached passively by default, which silently ignores
  // preventDefault() and lets the page scroll instead of zooming the map.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => ({
        ...t,
        scale: clamp(t.scale * (e.deltaY < 0 ? 1.1 : 0.9), MIN_SCALE, MAX_SCALE),
      }));
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  return (
    <div>
      <div className="text-center">
        <div className="text-4xl font-bold">{totalLearned}</div>
        <div className="mt-1 text-sm text-neutral-400">facts learned overall</div>
        <div className="mt-3 text-xs text-neutral-500">
          Your most recent {nodes.length}, connected below — drag the background to pan, drag a
          dot to bump it, pinch or scroll to zoom
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative mt-4 aspect-square w-full touch-none overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <svg
          ref={svgRef}
          viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
          className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
          role="img"
          aria-label="Your knowledge map"
        >
          <g stroke="#525252" strokeWidth={1} opacity={0.35}>
            {edges.map((e, i) => (
              <line key={i} ref={(el) => { lineRefs.current[i] = el; }} />
            ))}
          </g>
          {nodes.map((n) => (
            <circle
              key={n.id}
              ref={(el) => {
                if (el) circleRefs.current.set(n.id, el);
                else circleRefs.current.delete(n.id);
              }}
              data-node-id={n.id}
              r={radiusFor(n.id)}
              fill={n.category.colorHex}
              stroke="#0a0a0a"
              strokeWidth={1.5}
              className="cursor-grab active:cursor-grabbing"
            />
          ))}
        </svg>

        <button
          type="button"
          onClick={resetView}
          aria-label="Reset view"
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/90 text-sm backdrop-blur transition hover:bg-neutral-800"
        >
          ⟲
        </button>
      </div>

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

      {previewNode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setPreviewNode(null)}
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
            <button
              type="button"
              onClick={() => setPreviewNode(null)}
              aria-label="Close"
              className="absolute right-3 top-3 text-lg text-neutral-500 transition hover:text-neutral-200"
            >
              ✕
            </button>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: `${previewNode.category.colorHex}33`,
                color: previewNode.category.colorHex,
              }}
            >
              {previewNode.category.icon} {previewNode.category.name}
            </span>
            <h3 className="mt-3 pr-6 text-lg font-bold leading-snug">{previewNode.title}</h3>
            <p className="mt-2 line-clamp-3 text-sm text-neutral-400">{previewNode.body}</p>
            <Link
              href={`/card/${previewNode.id}`}
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-violet-400 transition hover:text-violet-300"
            >
              Read full card →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
