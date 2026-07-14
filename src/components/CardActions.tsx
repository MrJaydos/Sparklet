"use client";

import { useState } from "react";

/** Vote + save + share actions for the standalone card page — same APIs as
 * the feed's action rail, laid out horizontally for the document view. */
export function CardActions({
  cardId,
  cardTitle,
  initialScore,
  initialVote,
  initialSaved,
}: {
  cardId: string;
  cardTitle: string;
  initialScore: number;
  initialVote: number;
  initialSaved: boolean;
}) {
  const [score, setScore] = useState(initialScore);
  const [myVote, setMyVote] = useState(initialVote);
  const [saved, setSaved] = useState(initialSaved);
  const [copied, setCopied] = useState(false);

  const share = () => {
    const url = `${window.location.origin}/card/${cardId}`;
    if (navigator.share) {
      navigator.share({ title: cardTitle, text: cardTitle, url }).catch(() => {});
      return;
    }
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  const vote = async (value: 1 | -1) => {
    const next = myVote === value ? 0 : value;
    const prevVote = myVote;
    const prevScore = score;
    setMyVote(next);
    setScore(score + (next - myVote));
    try {
      const res = await fetch(`/api/cards/${cardId}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (res.ok) {
        const data = await res.json();
        setScore(data.score);
      } else {
        setMyVote(prevVote);
        setScore(prevScore);
      }
    } catch {
      setMyVote(prevVote);
      setScore(prevScore);
    }
  };

  const toggleSave = () => {
    const next = !saved;
    setSaved(next);
    fetch(`/api/cards/${cardId}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saved: next }),
    }).catch(() => {});
  };

  return (
    <div className="mt-5 flex items-center gap-3">
      <div className="flex items-center rounded-full bg-neutral-900 py-1">
        <button
          type="button"
          onClick={() => vote(1)}
          aria-label="Upvote"
          aria-pressed={myVote === 1}
          className={`px-3 py-1 text-base leading-none transition active:scale-125 ${
            myVote === 1 ? "text-emerald-400" : "text-neutral-400"
          }`}
        >
          ▲
        </button>
        <span
          className={`text-xs font-semibold tabular-nums ${
            score > 0 ? "text-emerald-400" : score < 0 ? "text-red-400" : "text-neutral-300"
          }`}
        >
          {score}
        </span>
        <button
          type="button"
          onClick={() => vote(-1)}
          aria-label="Downvote"
          aria-pressed={myVote === -1}
          className={`px-3 py-1 text-base leading-none transition active:scale-125 ${
            myVote === -1 ? "text-red-400" : "text-neutral-400"
          }`}
        >
          ▼
        </button>
      </div>

      <button
        type="button"
        onClick={toggleSave}
        aria-pressed={saved}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition active:scale-105 ${
          saved
            ? "bg-amber-500/15 text-amber-300"
            : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
        }`}
      >
        {saved ? "🔖 Saved" : "📑 Save"}
      </button>

      <button
        type="button"
        onClick={share}
        className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-neutral-400 transition hover:text-neutral-200 active:scale-105"
      >
        {copied ? "✅ Link copied" : "📤 Share"}
      </button>
    </div>
  );
}
