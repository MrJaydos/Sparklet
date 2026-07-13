"use client";

import { useState } from "react";

export type CategoryOption = {
  slug: string;
  name: string;
  colorHex: string;
  icon: string;
};

export function CategorySheet({
  categories,
  selected,
  onApply,
  onClose,
  autoRead,
  onToggleAutoRead,
}: {
  categories: CategoryOption[];
  selected: string[];
  onApply: (slugs: string[]) => void;
  onClose: () => void;
  autoRead: boolean;
  onToggleAutoRead: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);

  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-neutral-800 bg-neutral-950 p-6 pb-10">
        <h2 className="text-lg font-bold">Your feed</h2>
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

        <button
          type="button"
          onClick={onToggleAutoRead}
          aria-pressed={autoRead}
          className="mt-4 flex w-full items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm font-medium text-neutral-300 transition hover:border-neutral-600"
        >
          <span>🔊 Read cards aloud automatically</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              autoRead ? "bg-violet-600 text-white" : "bg-neutral-800 text-neutral-400"
            }`}
          >
            {autoRead ? "On" : "Off"}
          </span>
        </button>

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
