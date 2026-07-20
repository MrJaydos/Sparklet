"use client";

import { useState } from "react";
import Link from "next/link";
import type { PopoverAnchor } from "./usePopoverAnchor";

export type CategoryOption = {
  slug: string;
  name: string;
  colorHex: string;
  icon: string;
};

// Same key LearnCard reads to auto-apply a depth as cards scroll into view;
// STANDARD is stored but treated as "no preference".
const DEPTH_PREF_KEY = "sparklet.depth";
type DepthLevel = "SIMPLE" | "STANDARD" | "DEEP" | "EXTRA_DEEP";
const DEPTH_OPTIONS: { level: DepthLevel; label: string; blurb: string }[] = [
  { level: "SIMPLE", label: "✨ Simpler", blurb: "plain-English takes" },
  { level: "STANDARD", label: "📖 Standard", blurb: "the card as written" },
  { level: "DEEP", label: "🔬 Deeper", blurb: "more detail" },
  { level: "EXTRA_DEEP", label: "📚 Extra deep", blurb: "mini-articles" },
];

// Same key Feed reads to decide when to show the "goal complete" screen.
export const DAILY_CARD_GOAL_KEY = "sparklet.dailyGoal";
export const DEFAULT_DAILY_CARD_GOAL = 10;
const GOAL_OPTIONS = [5, 10, 15, 20, 30];

export function CategorySheet({
  categories,
  selected,
  premium,
  billingEnabled,
  onApply,
  onClose,
  onGoalChange,
  anchor,
}: {
  categories: CategoryOption[];
  selected: string[];
  /** Unlocks DEEP/EXTRA_DEEP as a persistent reading-depth preference. */
  premium: boolean;
  /** False pre-launch (before Stripe is configured) — everyone gets full access. */
  billingEnabled: boolean;
  onApply: (slugs: string[]) => void;
  onClose: () => void;
  onGoalChange: (goal: number) => void;
  /** Button position to drop down from (desktop). Omitted/null → full mobile sheet. */
  anchor?: PopoverAnchor | null;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [depth, setDepth] = useState<DepthLevel>(() => {
    try {
      const v = localStorage.getItem(DEPTH_PREF_KEY);
      return v === "SIMPLE" || v === "DEEP" || v === "EXTRA_DEEP" ? v : "STANDARD";
    } catch {
      return "STANDARD";
    }
  });
  const [goal, setGoal] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(DAILY_CARD_GOAL_KEY));
      return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_CARD_GOAL;
    } catch {
      return DEFAULT_DAILY_CARD_GOAL;
    }
  });

  const chooseGoal = (n: number) => {
    setGoal(n);
    onGoalChange(n);
    try {
      localStorage.setItem(DAILY_CARD_GOAL_KEY, String(n));
    } catch {
      /* private mode */
    }
  };

  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));

  const chooseDepth = (level: DepthLevel) => {
    setDepth(level);
    try {
      localStorage.setItem(DEPTH_PREF_KEY, level);
    } catch {
      /* private mode */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-start" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
        onClick={onClose}
      />
      {/* Full screen on mobile so nothing gets cut off; a compact anchored
          dropdown on desktop, matching NotificationsBell/SearchSheet. */}
      <div
        style={anchor ?? undefined}
        className="sheet-drop relative h-dvh overflow-y-auto rounded-none bg-neutral-950 p-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:absolute sm:h-auto sm:max-h-[32rem] sm:w-96 sm:rounded-2xl sm:border sm:border-neutral-800 sm:p-4 sm:pb-4 sm:pt-4 sm:shadow-2xl"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Your feed</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 py-1 text-lg text-neutral-500 transition hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          Pick topics, or select none for everything.
        </p>

        <button
          type="button"
          onClick={() => setPicked([])}
          className={`mt-4 w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
            picked.length === 0
              ? "border-violet-500 bg-violet-500/15 text-violet-300"
              : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
          }`}
        >
          🎲 Random / Everything
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {categories.map((c) => {
            const active = picked.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => toggle(c.slug)}
                className={`rounded-xl border px-3 py-3 text-left text-sm font-medium transition ${
                  active
                    ? "border-transparent text-white"
                    : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
                }`}
                style={active ? { backgroundColor: `${c.colorHex}40`, borderColor: c.colorHex } : undefined}
              >
                {c.icon} {c.name}
              </button>
            );
          })}
        </div>

        <h3 className="mt-5 text-sm font-semibold text-neutral-200">Reading depth</h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          How much detail cards show — applies from the next card you scroll to.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DEPTH_OPTIONS.map((o) => {
            const active = depth === o.level;
            const locked = (o.level === "DEEP" || o.level === "EXTRA_DEEP") && billingEnabled && !premium;
            if (locked) {
              return (
                <Link
                  key={o.level}
                  href="/upgrade"
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-left opacity-60 transition hover:border-violet-500 hover:opacity-100"
                >
                  <span className="block text-sm font-medium text-neutral-300">🔒 {o.label}</span>
                  <span className="block text-xs text-neutral-500">Premium — {o.blurb}</span>
                </Link>
              );
            }
            return (
              <button
                key={o.level}
                type="button"
                onClick={() => chooseDepth(o.level)}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-violet-500 bg-violet-500/15"
                    : "border-neutral-800 bg-neutral-900 hover:border-neutral-600"
                }`}
              >
                <span
                  className={`block text-sm font-medium ${active ? "text-violet-300" : "text-neutral-300"}`}
                >
                  {o.label}
                </span>
                <span className="block text-xs text-neutral-500">{o.blurb}</span>
              </button>
            );
          })}
        </div>

        <h3 className="mt-5 text-sm font-semibold text-neutral-200">Daily goal</h3>
        <p className="mt-0.5 text-xs text-neutral-500">
          Cards to hit each day before the feed celebrates and offers a break.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {GOAL_OPTIONS.map((n) => {
            const active = goal === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => chooseGoal(n)}
                aria-pressed={active}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-violet-500 bg-violet-500/15 text-violet-300"
                    : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onApply(picked)}
          className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-500"
        >
          {picked.length === 0 ? "Show me everything" : `Show ${picked.length} topic${picked.length > 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}
