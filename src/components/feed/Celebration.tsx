"use client";

import { useMemo } from "react";

/** XP payload returned by answer/interaction endpoints. */
export type XpInfo = {
  awarded: number;
  today: number;
  total: number;
  goal: number;
};

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

const COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899", "#facc15"];

// Deterministic jitter (render must stay pure — no Math.random): hash the
// particle index into a stable 0..1 value. Looks random, renders identically.
const jitter = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * One-shot confetti burst radiating from the center of its nearest
 * positioned ancestor. Mount it (keyed) when something worth celebrating
 * happens; it renders nothing after the animation ends.
 */
export function ConfettiBurst({ big = false }: { big?: boolean }) {
  const particles = useMemo(() => {
    const count = big ? 42 : 22;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + jitter(i, 1) * 0.5;
      const dist = (big ? 150 : 100) + jitter(i, 2) * (big ? 130 : 70);
      return {
        dx: `${Math.cos(angle) * dist}px`,
        dy: `${Math.sin(angle) * dist - 40}px`, // drift upward
        spin: `${Math.round(jitter(i, 3) * 720 - 360)}deg`,
        dur: `${700 + Math.round(jitter(i, 4) * 500)}ms`,
        color: COLORS[i % COLORS.length],
        size: 5 + Math.round(jitter(i, 5) * 5),
        round: jitter(i, 6) > 0.5,
      };
    });
  }, [big]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-1/2">
        {particles.map((p, i) => (
          <span
            key={i}
            className="confetti-particle absolute block"
            style={
              {
                width: p.size,
                height: p.round ? p.size : p.size * 1.8,
                backgroundColor: p.color,
                borderRadius: p.round ? "9999px" : "2px",
                "--dx": p.dx,
                "--dy": p.dy,
                "--spin": p.spin,
                "--dur": p.dur,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

/** "+N XP" chip with the combo multiplier callout, shown in answer results. */
export function XpReward({
  xp,
  combo,
  multiplier,
}: {
  xp: XpInfo;
  combo: number;
  multiplier: number;
}) {
  if (xp.awarded <= 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="xp-float inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-3 py-1 text-sm font-bold text-amber-300">
        ⚡ +{xp.awarded} XP
      </span>
      {combo >= 3 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-3 py-1 text-sm font-bold text-orange-300">
          🔥 {combo} in a row · ×{multiplier}
        </span>
      )}
    </div>
  );
}
