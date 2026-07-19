"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { usePopoverAnchor } from "./usePopoverAnchor";

/**
 * Daily streak badge for the feed header. Tapping it opens a popup
 * explaining how streaks work.
 *
 * On mobile (< sm): full-screen slide-down sheet.
 * On desktop (≥ sm): compact pill dropdown anchored to the button.
 * Both use a portal so the popup never blocks other header buttons.
 */
export function StreakBadge({
  streak,
  longestStreak,
  freezesAvailable,
}: {
  streak: number;
  longestStreak: number;
  freezesAvailable: number;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, anchor, measure } = usePopoverAnchor<HTMLButtonElement>();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          measure();
          setOpen(true);
        }}
        className="pointer-events-auto whitespace-nowrap rounded-full bg-neutral-900/80 px-2.5 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800"
        title="What is a streak?"
        aria-label="What is a streak?"
      >
        🔥 {streak}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-start"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
              onClick={() => setOpen(false)}
            />
            <div
              style={anchor ?? undefined}
              className="sheet-drop relative rounded-b-3xl border-b border-neutral-800 bg-neutral-950 p-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:absolute sm:w-80 sm:rounded-2xl sm:border sm:p-4 sm:pt-4 sm:shadow-2xl"
            >
              <div className="mx-auto w-full max-w-lg sm:mx-0 sm:max-w-none">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-lg font-bold">🔥 Streaks — stay consistent</h2>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="rounded-full px-2 py-1 text-sm text-neutral-500 transition hover:text-neutral-200"
                  >
                    ✕
                  </button>
                </div>

                <p className="mt-1 text-sm text-neutral-400">
                  {streak > 0
                    ? `You're on a ${streak}-day streak. Read at least one card a day to keep it going.`
                    : "Read at least one card today to start a streak."}
                </p>

                <ul className="mt-4 space-y-2 text-sm text-neutral-300">
                  <li className="flex justify-between gap-4">
                    <span>🔥 Current streak</span>
                    <span className="font-semibold text-amber-300">{streak} day{streak === 1 ? "" : "s"}</span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span>🏆 Longest streak</span>
                    <span className="font-semibold text-amber-300">{longestStreak} day{longestStreak === 1 ? "" : "s"}</span>
                  </li>
                  <li className="flex justify-between gap-4">
                    <span>🧊 Streak freezes</span>
                    <span className="font-semibold text-sky-300">
                      {freezesAvailable} left
                    </span>
                  </li>
                </ul>

                <p className="mt-4 rounded-xl bg-neutral-900 p-3 text-xs text-neutral-400">
                  🧊 <span className="text-neutral-200">Streak freezes:</span> you get 2 each
                  month. They automatically cover a missed day so your streak
                  doesn&apos;t break. Miss more days than you have freezes and the
                  streak resets.
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
