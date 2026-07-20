"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapNode, MapEdge } from "@/lib/knowledge-map";

const PADDING = 24; // margin around the settled graph inside the viewBox
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const DRAG_THRESHOLD = 4; // px — below this, a pointer gesture counts as a tap

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
  const positions = useMemo(
    () => new Map(positionList.map((p) => [p.id, { x: p.x, y: p.y }])),
    [positionList]
  );
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

  // Fit the viewBox to however the graph actually settled — an organic,
  // asymmetric shape, not a fixed square.
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
    maxX = 600;
    maxY = 600;
  }
  const viewX = minX - PADDING;
  const viewY = minY - PADDING;
  const viewW = maxX - minX + PADDING * 2;
  const viewH = maxY - minY + PADDING * 2;

  // Pan/zoom is a CSS transform on the <svg> itself, applied in screen-pixel
  // space — pointer deltas map 1:1 to translate() without needing to convert
  // through the viewBox's user-unit scale.
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [previewNode, setPreviewNode] = useState<MapNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(
    null
  );
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
          Your most recent {nodes.length}, connected below — drag to pan, pinch or scroll to zoom
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
          viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
          className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
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
              <circle
                key={n.id}
                data-node-id={n.id}
                cx={p.x}
                cy={p.y}
                r={radiusFor(n.id)}
                fill={n.category.colorHex}
                stroke="#0a0a0a"
                strokeWidth={1.5}
              />
            );
          })}
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
