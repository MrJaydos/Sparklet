"use client";

import Link from "next/link";
import { useState } from "react";
import type { FeedMisconception } from "@/lib/feed";
import { ConfettiBurst, XpReward, vibrate, type XpInfo } from "./Celebration";

type MisconceptionResult = {
  answer: boolean;
  correct: boolean;
  explanation: string;
  xp: XpInfo;
  combo: number;
  multiplier: number;
};

/**
 * Predict-then-reveal: commit to true/false on a widely-believed claim,
 * then see the correction. The commitment is what makes the reveal land —
 * same "before you see the answer" timing as GuessView.
 */
export function MisconceptionView({
  misconception,
  isGuest,
  onContinue,
  onResult,
}: {
  misconception: FeedMisconception;
  /** Signed-out visitor — still sees the real answer, just earns nothing. */
  isGuest?: boolean;
  onContinue: () => void;
  onResult: (r: { xp: XpInfo; correct: boolean; combo: number }) => void;
}) {
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<MisconceptionResult | null>(null);
  const [pickedGuess, setPickedGuess] = useState<boolean | null>(null);

  const lockIn = async (guess: boolean) => {
    if (locked) return;
    setLocked(true);
    setPickedGuess(guess);
    try {
      const res = await fetch(`/api/misconception/${misconception.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guess, tzOffsetMinutes: new Date().getTimezoneOffset() }),
      });
      if (!res.ok) {
        setLocked(false);
        setPickedGuess(null);
        return;
      }
      const data: MisconceptionResult = await res.json();
      setResult(data);
      vibrate(data.correct ? [30, 40, 60] : 20);
      onResult({ xp: data.xp, correct: data.correct, combo: data.combo });
    } catch {
      setLocked(false);
      setPickedGuess(null);
    }
  };

  return (
    <section className="relative flex h-dvh w-full snap-start flex-col overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(160deg, ${misconception.category.colorHex}26 0%, #0a0a0a 45%, #0a0a0a 100%)`,
        }}
      />
      {result?.correct && <ConfettiBurst big={result.combo >= 5} />}

      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-center px-5 pb-24 pt-16">
        <span
          className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            backgroundColor: `${misconception.category.colorHex}33`,
            color: misconception.category.colorHex,
          }}
        >
          🤨 True or false? · {misconception.category.name}
        </span>

        <h2 className="text-2xl font-bold leading-snug">{misconception.claim}</h2>

        {!result && (
          <div className="mt-8 flex gap-3">
            <button
              type="button"
              onClick={() => lockIn(true)}
              disabled={locked}
              className="flex-1 rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60"
            >
              {locked && pickedGuess === true ? "…" : "TRUE"}
            </button>
            <button
              type="button"
              onClick={() => lockIn(false)}
              disabled={locked}
              className="flex-1 rounded-xl bg-red-600 py-4 text-lg font-bold text-white transition hover:bg-red-500 disabled:opacity-60"
            >
              {locked && pickedGuess === false ? "…" : "FALSE"}
            </button>
          </div>
        )}

        {result && (
          <div className="mt-6">
            <div className="text-sm font-semibold text-neutral-300">
              {result.correct
                ? "🎯 Nailed it"
                : `😮 Actually ${result.answer ? "TRUE" : "FALSE"}`}
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span
                className="text-3xl font-extrabold tracking-tight"
                style={{ color: misconception.category.colorHex }}
              >
                {result.answer ? "TRUE" : "FALSE"}
              </span>
              <span className="text-sm text-neutral-400">
                you said {pickedGuess ? "true" : "false"}
              </span>
            </div>

            <div className="relative mt-5 rounded-xl bg-neutral-900/90 p-4">
              <p className="text-sm text-neutral-300">{result.explanation}</p>
              <XpReward xp={result.xp} combo={result.combo} multiplier={result.multiplier} />
              {isGuest && (
                <Link
                  href="/login?callbackUrl=%2Ffeed&reason=progress"
                  className="mt-2 flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300"
                >
                  ⚡ Sign in to track your progress and earn XP →
                </Link>
              )}
              <button
                type="button"
                onClick={onContinue}
                className="mt-3 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
              >
                Keep scrolling
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
