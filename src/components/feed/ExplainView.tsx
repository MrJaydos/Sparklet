"use client";

import { useState } from "react";
import type { FeedExplainPrompt } from "@/lib/feed";
import { XpReward, vibrate, type XpInfo } from "./Celebration";

type ExplainResult = {
  score: number;
  feedback: string;
  xp: XpInfo;
};

function headline(score: number) {
  if (score >= 0.9) return "🧠 Nailed it";
  if (score >= 0.7) return "👍 Pretty solid";
  if (score >= 0.4) return "🤔 Partway there";
  return "📖 Worth a re-read";
}

/**
 * Free recall: explain an already-seen card back in your own words, graded
 * by an LLM against the card body (Feynman technique). Signed-in only — the
 * feed query never surfaces this for guests (nothing seen/completed under
 * the guest sentinel), so there's no guest branch to handle here.
 */
export function ExplainView({
  prompt,
  onContinue,
  onResult,
}: {
  prompt: FeedExplainPrompt;
  onContinue: () => void;
  onResult: (r: { xp: XpInfo }) => void;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "graded">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExplainResult | null>(null);

  const submit = async () => {
    if (state === "sending" || text.trim().length < 10) return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/api/explain/${prompt.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, tzOffsetMinutes: new Date().getTimezoneOffset() }),
      });
      if (!res.ok) {
        setState("idle");
        setError(
          res.status === 429
            ? "Slow down a little — try again in a moment."
            : "Couldn't grade that — try again."
        );
        return;
      }
      const data: ExplainResult = await res.json();
      setResult(data);
      setState("graded");
      vibrate(data.score >= 0.7 ? [30, 40, 60] : 20);
      onResult({ xp: data.xp });
    } catch {
      setState("idle");
      setError("Couldn't grade that — try again.");
    }
  };

  return (
    <section className="relative flex h-dvh w-full snap-start flex-col overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(160deg, ${prompt.category.colorHex}26 0%, #0a0a0a 45%, #0a0a0a 100%)`,
        }}
      />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-center px-5 pb-24 pt-16">
        <span
          className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            backgroundColor: `${prompt.category.colorHex}33`,
            color: prompt.category.colorHex,
          }}
        >
          🧠 Explain it back · {prompt.category.name}
        </span>

        <h2 className="text-2xl font-bold leading-snug">
          In your own words: {prompt.title}
        </h2>

        {!result && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={600}
              rows={4}
              placeholder="Explain the idea like you're telling a friend…"
              disabled={state === "sending"}
              className="mt-6 w-full resize-none rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none focus:border-neutral-600"
            />
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <button
              type="button"
              onClick={submit}
              disabled={state === "sending" || text.trim().length < 10}
              className="mt-4 rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition enabled:hover:bg-violet-500 disabled:opacity-60"
            >
              {state === "sending" ? "Grading…" : "Submit"}
            </button>
          </>
        )}

        {result && (
          <div className="mt-6">
            <div className="text-sm font-semibold text-neutral-300">{headline(result.score)}</div>
            <div className="relative mt-5 rounded-xl bg-neutral-900/90 p-4">
              <p className="text-sm text-neutral-300">{result.feedback}</p>
              <XpReward xp={result.xp} combo={0} multiplier={1} />
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
