"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FeedCard } from "@/lib/feed";
import { timeAgo } from "@/lib/time";
import { CardImage } from "@/components/CardImage";

type DepthLevel = "SIMPLE" | "STANDARD" | "DEEP" | "EXTRA_DEEP";
type DepthVariant = { title: string; body: string; level: DepthLevel };

const DEPTH_PREF_KEY = "sparklet.depth";

export function LearnCard({
  card,
  saved,
  commentCount,
  speaking,
  onToggleSpeak,
  onToggleSave,
  onOpenComments,
  onReport,
}: {
  card: FeedCard;
  saved: boolean;
  commentCount: number;
  speaking: boolean;
  onToggleSpeak: () => void;
  onToggleSave: () => void;
  onOpenComments: () => void;
  onReport: () => void;
}) {
  const [score, setScore] = useState(card.score);
  const [myVote, setMyVote] = useState(card.myVote);
  const [variant, setVariant] = useState<DepthVariant | null>(null);
  const [depthLoading, setDepthLoading] = useState<Exclude<DepthLevel, "STANDARD"> | null>(null);
  const [depthUnavailable, setDepthUnavailable] = useState(false);
  const variantCache = useState<Map<string, DepthVariant>>(() => new Map())[0];

  const level = variant?.level ?? "STANDARD";
  const shownTitle = variant?.title ?? card.title;
  const shownBody = variant?.body ?? card.body;

  const setDepth = async (target: DepthLevel) => {
    if (target === "STANDARD") {
      setVariant(null);
      return;
    }
    const cached = variantCache.get(target);
    if (cached) {
      setVariant(cached);
      return;
    }
    if (depthLoading) return;
    setDepthLoading(target);
    try {
      const res = await fetch(`/api/cards/${card.id}/depth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: target }),
      });
      if (res.ok) {
        const data = await res.json();
        const v: DepthVariant = { title: data.card.title, body: data.card.body, level: target };
        variantCache.set(target, v);
        setVariant(v);
      } else if (res.status === 503) {
        setDepthUnavailable(true);
      }
    } catch {
      /* leave standard text showing */
    } finally {
      setDepthLoading(null);
    }
  };

  // A manual tap is also a preference: keep serving that depth on future
  // cards until the user switches back to Standard.
  const chooseDepth = (target: DepthLevel) => {
    try {
      localStorage.setItem(DEPTH_PREF_KEY, target);
    } catch {
      /* private mode */
    }
    setDepth(target);
  };

  // Auto-apply the remembered depth when this card first scrolls into view
  // (per-view, so a fast scroll doesn't fire a generation for every card).
  const setDepthRef = useRef(setDepth);
  useEffect(() => {
    setDepthRef.current = setDepth;
  });
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let pref: string | null = null;
    try {
      pref = localStorage.getItem(DEPTH_PREF_KEY);
    } catch {
      return;
    }
    if (pref !== "SIMPLE" && pref !== "DEEP" && pref !== "EXTRA_DEEP") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          setDepthRef.current(pref as DepthLevel);
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Swipe left/right to vote (touch): horizontal drags grow a ▲/▼ overlay
  // and commit past the threshold; vertical swipes stay the feed's scroll.
  const SWIPE_THRESHOLD = 80;
  const [dragX, setDragX] = useState(0);
  const [swipeFlash, setSwipeFlash] = useState<{ text: string; up: boolean } | null>(null);
  const swipeFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRef = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [data-lightbox]")) return;
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, horizontal: null };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const t = touchRef.current;
    if (!t) return;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (t.horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      t.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (t.horizontal) setDragX(Math.max(-140, Math.min(140, dx)));
  };

  const endTouch = () => {
    const committed = touchRef.current?.horizontal && Math.abs(dragX) >= SWIPE_THRESHOLD;
    if (committed) {
      const dir: 1 | -1 = dragX > 0 ? 1 : -1;
      const removing = myVote === dir;
      vote(dir);
      if (swipeFlashTimer.current) clearTimeout(swipeFlashTimer.current);
      setSwipeFlash({
        text: removing ? "Vote removed" : dir === 1 ? "▲ Upvoted" : "▼ Downvoted",
        up: dir === 1 && !removing,
      });
      swipeFlashTimer.current = setTimeout(() => setSwipeFlash(null), 900);
    }
    touchRef.current = null;
    setDragX(0);
  };

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
      ref={rootRef}
      className="relative flex h-dvh w-full snap-start flex-col overflow-hidden"
      data-card-id={card.id}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={endTouch}
      onTouchCancel={endTouch}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(160deg, ${card.category.colorHex}26 0%, #0a0a0a 45%, #0a0a0a 100%)`,
        }}
      />

      {/* Swipe-to-vote feedback */}
      {dragX !== 0 && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div
            style={{
              opacity: Math.min(1, Math.abs(dragX) / SWIPE_THRESHOLD),
              transform: `scale(${0.85 + Math.min(0.15, Math.abs(dragX) / (SWIPE_THRESHOLD * 6))})`,
            }}
            className={`rounded-2xl px-6 py-4 text-2xl font-bold backdrop-blur ${
              dragX > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
            }`}
          >
            {dragX > 0
              ? myVote === 1
                ? "▲ Remove upvote"
                : "▲ Upvote"
              : myVote === -1
                ? "▼ Remove downvote"
                : "▼ Downvote"}
          </div>
        </div>
      )}
      {swipeFlash && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div
            className={`rounded-2xl bg-neutral-900/90 px-6 py-4 text-2xl font-bold backdrop-blur ${
              swipeFlash.text === "Vote removed"
                ? "text-neutral-300"
                : swipeFlash.up
                  ? "text-emerald-300"
                  : "text-red-300"
            }`}
          >
            {swipeFlash.text}
          </div>
        </div>
      )}

      <div
        className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col justify-end px-5 pb-[calc(env(safe-area-inset-bottom)+4rem)] pt-[calc(env(safe-area-inset-top)+4rem)]"
        style={{
          transform: `translateX(${dragX * 0.35}px)`,
          transition: dragX === 0 ? "transform 150ms ease-out" : "none",
        }}
      >
        {card.imageUrl && (
          <CardImage src={card.imageUrl} className="mb-4 max-h-[32dvh] rounded-2xl" />
        )}
        <div className="pr-16">{/* keep text clear of the action rail */}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${card.category.colorHex}33`, color: card.category.colorHex }}
          >
            {card.category.icon} {card.category.name}
          </span>
          {card.review && (
            <span className="rounded-full bg-violet-500/20 px-3 py-1 text-xs font-semibold text-violet-300">
              🔁 Review — seen this one?
            </span>
          )}
          {card.seen && !card.review && (
            <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
              seen before
            </span>
          )}
          <span className="text-xs text-neutral-500" title="When this card was published">
            published {timeAgo(card.createdAt)}
          </span>
        </div>

        {/* Long-form variants scroll inside the card; the feed's wheel
            handler yields to [data-wheel-scroll] so desktop can read them. */}
        <div
          data-wheel-scroll
          className={level === "EXTRA_DEEP" ? "max-h-[45dvh] overflow-y-auto pr-2" : ""}
        >
          <h2 className="text-xl font-bold leading-snug sm:text-3xl">{shownTitle}</h2>
          <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-neutral-300 sm:text-lg">
            {shownBody}
          </p>
        </div>

        {/* Depth toggle — an enhancement; standard text never depends on it.
            Choices persist as a preference for subsequent cards. */}
        {!depthUnavailable && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {(
              [
                ["SIMPLE", "✨ Simpler"],
                ["STANDARD", "↩ Standard"],
                ["DEEP", "🔬 Go deeper"],
                ["EXTRA_DEEP", "📚 Extra deep"],
              ] as [DepthLevel, string][]
            )
              .filter(([l]) => l !== level)
              .map(([l, label]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => chooseDepth(l)}
                  disabled={depthLoading !== null && l !== "STANDARD"}
                  className="rounded-full border border-neutral-800 px-3 py-1 text-neutral-400 transition hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50"
                >
                  {depthLoading === l ? "…" : label}
                </button>
              ))}
          </div>
        )}

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
          <a
            href={card.readMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex whitespace-nowrap rounded-full bg-neutral-100 px-3.5 py-1 text-xs font-semibold text-neutral-900 transition hover:bg-white"
          >
            Read more ↗
          </a>
        </div>

        {/* Related trail — somewhere for curiosity to go next */}
        {card.related.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-neutral-500">Connects to</span>
            {card.related.map((r) => (
              <Link
                key={r.id}
                href={`/card/${r.id}`}
                className="max-w-[15rem] truncate rounded-full border border-dashed border-neutral-700 px-3 py-1 text-neutral-300 transition hover:border-neutral-500 hover:text-white"
              >
                {r.icon} {r.title}
              </Link>
            ))}
          </div>
        )}
        </div>{/* /pr-16 */}

      {/* Action rail — TikTok-style vertical stack, clear of the text column */}
      <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+4rem)] right-2 z-20 flex w-14 flex-col items-center gap-2.5">
        <div className="flex flex-col items-center rounded-full bg-neutral-900/70 py-1 backdrop-blur">
          <button
            type="button"
            onClick={() => vote(1)}
            aria-label="Upvote"
            aria-pressed={myVote === 1}
            className={`px-3 py-1 text-lg leading-none transition active:scale-125 ${
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
            className={`px-3 py-1 text-lg leading-none transition active:scale-125 ${
              myVote === -1 ? "text-red-400" : "text-neutral-400"
            }`}
          >
            ▼
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenComments}
          aria-label="Comments"
          className="flex h-11 w-11 flex-col items-center justify-center rounded-full bg-neutral-900/70 text-lg backdrop-blur transition active:scale-110"
        >
          💬
          {commentCount > 0 && (
            <span className="-mt-1 text-[10px] font-semibold text-neutral-300">
              {commentCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleSave}
          aria-label={saved ? "Remove from notebook" : "Save to notebook"}
          aria-pressed={saved}
          className={`flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900/70 text-lg backdrop-blur transition active:scale-125 ${
            saved ? "text-amber-300" : "opacity-70"
          }`}
        >
          {saved ? "🔖" : "📑"}
        </button>

        <button
          type="button"
          onClick={onToggleSpeak}
          aria-label={speaking ? "Stop reading" : "Read card aloud"}
          aria-pressed={speaking}
          className={`flex h-11 w-11 items-center justify-center rounded-full text-lg backdrop-blur transition ${
            speaking ? "bg-violet-600/80 text-white" : "bg-neutral-900/70 opacity-70"
          }`}
        >
          {speaking ? "⏹" : "🔊"}
        </button>

        <button
          type="button"
          onClick={onReport}
          aria-label="Report card"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/50 text-sm text-neutral-500 backdrop-blur transition hover:text-neutral-300"
        >
          ⚑
        </button>
      </div>
      </div>{/* /content column */}
    </article>
  );
}
