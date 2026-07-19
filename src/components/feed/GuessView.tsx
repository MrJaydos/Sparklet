"use client";

import { useState } from "react";
import type { FeedGuess } from "@/lib/feed";
import { ConfettiBurst, XpReward, vibrate, type XpInfo } from "./Celebration";

type GuessResult = {
  answer: number;
  accuracy: number;
  correct: boolean;
  explanation: string;
  sourceCardId: string;
  xp: XpInfo;
  combo: number;
  multiplier: number;
};

const fmt = new Intl.NumberFormat("en", { maximumSignificantDigits: 4 });

function headline(accuracy: number) {
  if (accuracy >= 0.95) return "🎯 Scary close!";
  if (accuracy >= 0.85) return "🎯 Great instincts";
  if (accuracy >= 0.6) return "👀 Not bad at all";
  if (accuracy >= 0.3) return "🤔 Further than you thought";
  return "🤯 Way off — that's the fun part";
}

/**
 * Guess-before-reveal: predict a number on a slider, then see the real
 * answer. The reveal is the learning moment — closeness scales the XP.
 */
export function GuessView({
  guess,
  isGuest,
  onRequireAuth,
  onContinue,
  onResult,
}: {
  guess: FeedGuess;
  /** Signed-out visitor — locking in an answer prompts sign-in instead. */
  isGuest?: boolean;
  onRequireAuth?: () => void;
  onContinue: () => void;
  onResult: (r: { xp: XpInfo; correct: boolean; combo: number }) => void;
}) {
  const range = guess.max - guess.min;
  // Whole-number answers (a count of patients, years, etc.) get whole-number
  // steps — otherwise the slider lands on nonsense like "5.62 patients".
  // Still capped at ~100 positions so a huge integer range isn't 1-at-a-time.
  const step = guess.integer ? Math.max(1, Math.round(range / 100)) : range / 100;
  const mid = guess.min + Math.round((range / 2) / step) * step;
  const [value, setValue] = useState(mid);
  const [moved, setMoved] = useState(false);
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<GuessResult | null>(null);

  const pct = ((value - guess.min) / range) * 100;
  const withUnit = (n: number) =>
    guess.unit === "%" ? `${fmt.format(n)}%` : `${fmt.format(n)}${guess.unit ? ` ${guess.unit}` : ""}`;

  const lockIn = async () => {
    if (locked) return;
    if (isGuest) {
      onRequireAuth?.();
      return;
    }
    setLocked(true);
    try {
      const res = await fetch(`/api/guess/${guess.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guess: value, tzOffsetMinutes: new Date().getTimezoneOffset() }),
      });
      if (!res.ok) {
        setLocked(false);
        return;
      }
      const data: GuessResult = await res.json();
      setResult(data);
      vibrate(data.correct ? [30, 40, 60] : 20);
      onResult({ xp: data.xp, correct: data.correct, combo: data.combo });
    } catch {
      setLocked(false);
    }
  };

  const answerPct = result ? ((result.answer - guess.min) / range) * 100 : 0;

  return (
    <section className="relative flex h-dvh w-full snap-start flex-col overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(160deg, ${guess.category.colorHex}26 0%, #0a0a0a 45%, #0a0a0a 100%)`,
        }}
      />
      {result?.correct && <ConfettiBurst big={result.combo >= 5} />}

      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-center px-5 pb-24 pt-16">
        <span
          className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            backgroundColor: `${guess.category.colorHex}33`,
            color: guess.category.colorHex,
          }}
        >
          🔮 Take a guess · {guess.category.name}
        </span>

        <h2 className="text-2xl font-bold leading-snug">{guess.prompt}</h2>

        {!result && (
          <>
            <div className="mt-8 text-center">
              <span
                className="text-5xl font-extrabold tabular-nums tracking-tight"
                style={{ color: guess.category.colorHex }}
              >
                {withUnit(value)}
              </span>
              {!moved && (
                <p className="mt-2 text-xs text-neutral-500">Drag the slider — gut feel counts</p>
              )}
            </div>
            <input
              type="range"
              className="guess-slider mt-6 w-full"
              style={
                {
                  "--slider-color": guess.category.colorHex,
                  "--slider-pct": `${pct}%`,
                } as React.CSSProperties
              }
              min={guess.min}
              max={guess.max}
              step={step}
              value={value}
              disabled={locked}
              onChange={(e) => {
                setValue(Number(e.target.value));
                setMoved(true);
              }}
              aria-label="Your guess"
            />
            <div className="mt-1.5 flex justify-between text-xs text-neutral-500">
              <span>{withUnit(guess.min)}</span>
              <span>{withUnit(guess.max)}</span>
            </div>
            <button
              type="button"
              onClick={lockIn}
              disabled={locked}
              className="mt-8 rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
            >
              {locked ? "…" : "Lock it in"}
            </button>
          </>
        )}

        {result && (
          <div className="mt-6">
            <div className="text-sm font-semibold text-neutral-300">{headline(result.accuracy)}</div>
            <div className="mt-2 flex items-baseline gap-3">
              <span
                className="text-5xl font-extrabold tabular-nums tracking-tight"
                style={{ color: guess.category.colorHex }}
              >
                {withUnit(result.answer)}
              </span>
              <span className="text-sm text-neutral-400">you said {withUnit(value)}</span>
            </div>

            {/* Guess vs answer on the same track */}
            <div className="relative mt-5 h-2 rounded-full bg-neutral-800">
              <span
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950 bg-neutral-400"
                style={{ left: `${pct}%` }}
                title="Your guess"
              />
              <span
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950"
                style={{ left: `${answerPct}%`, backgroundColor: guess.category.colorHex }}
                title="The answer"
              />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-neutral-500">
              <span>{withUnit(guess.min)}</span>
              <span>{withUnit(guess.max)}</span>
            </div>

            <div className="relative mt-5 rounded-xl bg-neutral-900/90 p-4">
              <p className="text-sm text-neutral-300">{result.explanation}</p>
              <XpReward xp={result.xp} combo={result.combo} multiplier={result.multiplier} />
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
