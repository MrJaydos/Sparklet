"use client";

import { useState } from "react";

/**
 * Daily XP goal ring for the feed header: fills as today's XP approaches
 * the goal, turns gold when the goal is met. Tapping it explains what XP
 * is and how to earn it.
 */
export function XpRing({ today, goal }: { today: number; goal: number }) {
  const [open, setOpen] = useState(false);
  const progress = Math.min(1, today / goal);
  const done = today >= goal;
  const r = 8;
  const c = 2 * Math.PI * r;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-neutral-900/80 py-1.5 pl-2 pr-2.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800"
        title={done ? `Daily goal reached — ${today} XP today` : `${today}/${goal} XP today`}
        aria-label="What is XP?"
      >
        <span className="relative flex h-5 w-5 items-center justify-center">
          <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90">
            <circle cx="10" cy="10" r={r} fill="none" stroke="#262626" strokeWidth="2.5" />
            <circle
              cx="10"
              cy="10"
              r={r}
              fill="none"
              stroke={done ? "#f59e0b" : "#8b5cf6"}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - progress)}
              style={{ transition: "stroke-dashoffset 500ms ease, stroke 500ms ease" }}
            />
          </svg>
          <span className="absolute text-[8px] leading-none" aria-hidden>
            ⚡
          </span>
        </span>
        <span className={done ? "text-amber-300" : "text-neutral-200"}>
          {done ? today : `${today}/${goal}`}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-start"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="sheet-drop relative rounded-b-3xl border-b border-neutral-800 bg-neutral-950 p-5 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
            <div className="mx-auto w-full max-w-lg">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-bold">⚡ XP — your daily learning goal</h2>
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
                {done
                  ? `Goal smashed — ${today} XP today. Everything from here is a bonus.`
                  : `${today} of ${goal} XP today — the ring fills as you learn.`}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full rounded-full ${done ? "bg-amber-400" : "bg-violet-500"}`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>

              <ul className="mt-4 space-y-2 text-sm text-neutral-300">
                <li className="flex justify-between gap-4">
                  <span>📖 Read a new card</span>
                  <span className="font-semibold text-amber-300">+1</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>🔁 Recall a review card</span>
                  <span className="font-semibold text-amber-300">+5</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>🧠 Answer a quiz</span>
                  <span className="font-semibold text-amber-300">+10 right · +2 for trying</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>🔮 Lock in a guess</span>
                  <span className="font-semibold text-amber-300">+2–10 by closeness</span>
                </li>
              </ul>

              <p className="mt-4 rounded-xl bg-neutral-900 p-3 text-xs text-neutral-400">
                🔥 <span className="text-neutral-200">Combos:</span> correct quiz and guess answers
                in a row multiply your XP — ×1.5 from a 3-streak, ×2 from 5, ×3 from 10. One wrong
                answer resets the run.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
