"use client";

import Link from "next/link";
import { useState } from "react";
import type { FeedQuiz } from "@/lib/feed";
import { ConfettiBurst, XpReward, vibrate, type XpInfo } from "./Celebration";

type QuizResult = {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  xp: XpInfo;
  combo: number;
  multiplier: number;
};

/** Low-stakes recall quiz: instant answer + explanation, XP + combo reward.
 * `variant="review"` renders the same question in place of a due spaced-
 * repetition review card — a wrong answer re-queues the source card instead
 * of just failing a checkpoint quiz, so it posts to a different endpoint. */
export function QuizView({
  quiz,
  isGuest,
  variant = "checkpoint",
  onContinue,
  onResult,
}: {
  quiz: FeedQuiz;
  /** Signed-out visitor — still answers for real, just earns nothing. */
  isGuest?: boolean;
  variant?: "checkpoint" | "review";
  onContinue: () => void;
  onResult: (r: { xp: XpInfo; correct: boolean; combo: number }) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);

  const answer = async (index: number) => {
    if (picked !== null) return;
    setPicked(index);
    try {
      const endpoint =
        variant === "review" ? `/api/reviews/${quiz.id}/answer` : `/api/quiz/${quiz.id}/answer`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ index, tzOffsetMinutes: new Date().getTimezoneOffset() }),
      });
      if (res.ok) {
        const data: QuizResult = await res.json();
        setResult(data);
        vibrate(data.correct ? [30, 40, 60] : 20);
        onResult({ xp: data.xp, correct: data.correct, combo: data.combo });
      }
    } catch {
      /* leave picked highlighted; user can continue */
    }
  };

  return (
    <section className="relative flex h-dvh w-full snap-start flex-col overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(160deg, ${quiz.category.colorHex}26 0%, #0a0a0a 45%, #0a0a0a 100%)`,
        }}
      />
      {result?.correct && <ConfettiBurst big={result.combo >= 5} />}

      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-center px-5 pb-24 pt-16">
        {variant === "review" ? (
          <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-violet-500/20 px-3 py-1 text-xs font-semibold text-violet-300">
            🔁 Review — do you remember?
          </span>
        ) : (
          <span
            className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${quiz.category.colorHex}33`, color: quiz.category.colorHex }}
          >
            🧠 Quick recall · {quiz.category.name}
          </span>
        )}

        <h2 className="text-2xl font-bold leading-snug">{quiz.question}</h2>

        <div className="mt-6 space-y-2">
          {quiz.options.map((option, i) => {
            let style =
              "border-neutral-700 bg-neutral-900/80 text-neutral-200 hover:border-neutral-500";
            if (result) {
              if (i === result.correctIndex)
                style = "border-emerald-500 bg-emerald-500/15 text-emerald-300";
              else if (i === picked)
                style = "border-red-500 bg-red-500/15 text-red-300";
              else style = "border-neutral-800 bg-neutral-900/50 text-neutral-500";
            } else if (i === picked) {
              style = "border-violet-500 bg-violet-500/15 text-violet-300";
            }
            return (
              <button
                key={i}
                type="button"
                disabled={picked !== null}
                onClick={() => answer(i)}
                className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${style}`}
              >
                {option}
              </button>
            );
          })}
        </div>

        {result && (
          <div className="mt-5 rounded-xl bg-neutral-900/90 p-4">
            <div className="text-sm font-semibold">
              {result.correct ? "✅ Nailed it" : "💡 Good try — now you know"}
            </div>
            <p className="mt-1 text-sm text-neutral-400">{result.explanation}</p>
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
        )}
      </div>
    </section>
  );
}
