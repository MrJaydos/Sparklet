"use client";

import type { FeedCard } from "@/lib/feed";

export function LearnCard({
  card,
  liked,
  onToggleLike,
}: {
  card: FeedCard;
  liked: boolean;
  onToggleLike: () => void;
}) {
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
          <div className="mb-5 max-h-[38dvh] overflow-hidden rounded-2xl">
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
        <div className="mt-5 flex flex-wrap items-center gap-2">
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

        <div className="mt-5 flex items-center justify-between">
          <a
            href={card.readMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white"
          >
            Read more ↗
          </a>
          <button
            type="button"
            onClick={onToggleLike}
            aria-label={liked ? "Unlike" : "Like"}
            aria-pressed={liked}
            className={`rounded-full px-4 py-2.5 text-2xl transition active:scale-125 ${
              liked ? "" : "grayscale opacity-60 hover:opacity-100"
            }`}
          >
            ❤️
          </button>
        </div>
      </div>
    </article>
  );
}
