"use client";

import { useState } from "react";
import type { FeedCard } from "@/lib/feed";

export function LearnCard({
  card,
  liked,
  commentCount,
  speaking,
  onToggleSpeak,
  onToggleLike,
  onOpenComments,
  onReport,
}: {
  card: FeedCard;
  liked: boolean;
  commentCount: number;
  speaking: boolean;
  onToggleSpeak: () => void;
  onToggleLike: () => void;
  onOpenComments: () => void;
  onReport: () => void;
}) {
  const [score, setScore] = useState(card.score);
  const [myVote, setMyVote] = useState(card.myVote);

  const vote = async (value: 1 | -1) => {
    const next = myVote === value ? 0 : value;
    const prevVote = myVote;
    const prevScore = score;
    setMyVote(next);
    setScore(score + (next - myVote));
    try {
      const res = await fetch(`/api/cards/${card.id}/vote`, {
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

  return (
    <article
      className="relative flex h-dvh w-full snap-start flex-col overflow-hidden"
      data-card-id={card.id}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(160deg, ${card.category.colorHex}26 0%, #0a0a0a 45%, #0a0a0a 100%)`,
        }}
      />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-end px-5 pb-24 pt-16">
        {card.imageUrl && (
          <div className="mb-5 max-h-[35dvh] overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={card.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).parentElement!.style.display = "none";
              }}
            />
          </div>
        )}

        <div className="mb-3 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${card.category.colorHex}33`, color: card.category.colorHex }}
          >
            {card.category.icon} {card.category.name}
          </span>
          {card.seen && (
            <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
              seen before
            </span>
          )}
        </div>

        <h2 className="text-2xl font-bold leading-snug sm:text-3xl">{card.title}</h2>
        <p className="mt-3 text-base leading-relaxed text-neutral-300 sm:text-lg">
          {card.body}
        </p>

        {/* Sources — deliberately visible, not tucked away */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {card.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-neutral-700 bg-neutral-900/80 px-3 py-1 text-xs text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
              title={s.title}
            >
              🔗 {s.publisher}
            </a>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <a
            href={card.readMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white"
          >
            Read more ↗
          </a>

          <div className="flex items-center gap-1">
            {/* Vote group */}
            <div className="flex items-center rounded-full bg-neutral-900/80 backdrop-blur">
              <button
                type="button"
                onClick={() => vote(1)}
                aria-label="Upvote"
                aria-pressed={myVote === 1}
                className={`rounded-l-full px-2.5 py-2 text-lg transition active:scale-125 ${
                  myVote === 1 ? "text-emerald-400" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                ▲
              </button>
              <span
                className={`min-w-6 text-center text-sm font-semibold tabular-nums ${
                  score > 0 ? "text-emerald-400" : score < 0 ? "text-red-400" : "text-neutral-400"
                }`}
              >
                {score}
              </span>
              <button
                type="button"
                onClick={() => vote(-1)}
                aria-label="Downvote"
                aria-pressed={myVote === -1}
                className={`rounded-r-full px-2.5 py-2 text-lg transition active:scale-125 ${
                  myVote === -1 ? "text-red-400" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                ▼
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleSpeak}
              aria-label={speaking ? "Stop reading" : "Read card aloud"}
              aria-pressed={speaking}
              title={speaking ? "Stop reading" : "Read aloud"}
              className={`rounded-full px-3 py-2 text-sm backdrop-blur transition ${
                speaking
                  ? "bg-violet-600/80 text-white"
                  : "bg-neutral-900/80 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {speaking ? "⏹" : "🔊"}
            </button>

            <button
              type="button"
              onClick={onOpenComments}
              aria-label="Comments"
              className="rounded-full bg-neutral-900/80 px-3 py-2 text-sm text-neutral-300 backdrop-blur transition hover:bg-neutral-800"
            >
              💬 {commentCount > 0 ? commentCount : ""}
            </button>

            <button
              type="button"
              onClick={onToggleLike}
              aria-label={liked ? "Unlike" : "Like"}
              aria-pressed={liked}
              className={`rounded-full bg-neutral-900/80 px-3 py-2 text-sm backdrop-blur transition active:scale-125 ${
                liked ? "" : "grayscale opacity-60 hover:opacity-100"
              }`}
            >
              ❤️
            </button>

            <button
              type="button"
              onClick={onReport}
              aria-label="Report card"
              title="Report"
              className="rounded-full bg-neutral-900/80 px-3 py-2 text-sm text-neutral-500 backdrop-blur transition hover:text-neutral-300"
            >
              ⚑
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
