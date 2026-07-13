"use client";

import { useState } from "react";
import type { FeedQuiz } from "@/lib/feed";

/** Low-stakes recall quiz: instant answer + explanation, no scores kept. */
export function QuizView({ quiz, onContinue }: { quiz: FeedQuiz; onContinue: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<{
    correct: boolean;
    correctIndex: number;
    explanation: string;
  } | null>(null);

  const answer = async (index: number) => {
    if (picked !== null) return;
    setPicked(index);
    try {
      const res = await fetch(`/api/quiz/${quiz.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ index }),
      });
      if (res.ok) setResult(await res.json());
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
      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-center px-5 pb-24 pt-16">
        <span
          className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: `${quiz.category.colorHex}33`, color: quiz.category.colorHex }}
        >
          🧠 Quick recall · {quiz.category.name}
        </span>

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
