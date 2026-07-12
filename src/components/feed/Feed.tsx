"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedCard } from "@/lib/feed";
import { LearnCard } from "./LearnCard";
import { CategorySheet, type CategoryOption } from "./CategorySheet";
import { CommentsSheet } from "./CommentsSheet";
import { ReportSheet } from "./ReportSheet";

const CHECKIN_EVERY = 15; // soft session check-in cadence
const STORAGE_KEY = "sparklet.categories";

type FeedItem =
  | { kind: "card"; card: FeedCard }
  | { kind: "checkin"; afterCount: number }
  | { kind: "end" };

export function Feed({
  initialCards,
  initialExhausted,
  categories,
  initialStreak,
  initialUnread,
}: {
  initialCards: FeedCard[];
  initialExhausted: boolean;
  categories: CategoryOption[];
  initialStreak: number;
  initialUnread: number;
}) {
  const [cards, setCards] = useState<FeedCard[]>(initialCards);
  const [exhausted, setExhausted] = useState(initialExhausted);
  const [selected, setSelected] = useState<string[]>([]);
  const [likes, setLikes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialCards.map((c) => [c.id, c.liked]))
  );
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialCards.map((c) => [c.id, c.commentCount]))
  );
  const [streak, setStreak] = useState(initialStreak);
  const [showSheet, setShowSheet] = useState(false);
  const [commentsFor, setCommentsFor] = useState<FeedCard | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [sessionViews, setSessionViews] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewedRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const fetchCards = useCallback(
    async (slugs: string[], opts?: { reset?: boolean; allowRepeats?: boolean }) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (slugs.length) params.set("categories", slugs.join(","));
        if (opts?.allowRepeats) params.set("allowRepeats", "1");
        if (!opts?.reset && cardsRef.current.length) {
          params.set("exclude", cardsRef.current.map((c) => c.id).join(","));
        }
        const res = await fetch(`/api/feed?${params}`);
        if (!res.ok) return;
        const data: { cards: FeedCard[]; exhausted: boolean } = await res.json();
        setLikes((prev) => ({
          ...Object.fromEntries(data.cards.map((c) => [c.id, c.liked])),
          ...(opts?.reset ? {} : prev),
        }));
        setCommentCounts((prev) => ({
          ...Object.fromEntries(data.cards.map((c) => [c.id, c.commentCount])),
          ...(opts?.reset ? {} : prev),
        }));
        setCards((prev) => (opts?.reset ? data.cards : [...prev, ...data.cards]));
        setExhausted(data.exhausted && data.cards.length === 0 ? true : data.exhausted);
        if (opts?.reset) {
          viewedRef.current = new Set();
          containerRef.current?.scrollTo({ top: 0 });
        }
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    []
  );

  // Restore saved topic selection (may differ from the server-rendered feed).
  useEffect(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (saved.length) {
        // Deferred so the restore doesn't force a cascading render mid-hydration.
        queueMicrotask(() => {
          setSelected(saved);
          fetchCards(saved, { reset: true });
        });
      }
    } catch {
      /* ignore corrupt storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markViewed = useCallback(async (cardId: string) => {
    if (viewedRef.current.has(cardId)) return;
    viewedRef.current.add(cardId);
    setSessionViews((n) => n + 1);
    try {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cardId,
          action: "view",
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.streak) setStreak(data.streak.currentStreak);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  const toggleLike = useCallback((cardId: string) => {
    setLikes((prev) => {
      const liked = !prev[cardId];
      fetch("/api/interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId, action: liked ? "like" : "unlike" }),
      }).catch(() => {});
      return { ...prev, [cardId]: liked };
    });
  }, []);

  // Observe cards for view-tracking and infinite fetch.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const id = el.dataset.cardId;
          if (id) markViewed(id);
          const idx = Number(el.dataset.index);
          if (!Number.isNaN(idx) && idx >= cardsRef.current.length - 3 && !exhausted) {
            fetchCards(selected);
          }
        }
      },
      { root: container, threshold: 0.6 }
    );
    container.querySelectorAll("[data-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [cards, selected, exhausted, markViewed, fetchCards]);

  // Keyboard navigation for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== " ") return;
      if (showSheet || commentsFor || reportFor) return;
      e.preventDefault();
      containerRef.current?.scrollBy({
        top: (e.key === "ArrowUp" ? -1 : 1) * window.innerHeight,
        behavior: "smooth",
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSheet, commentsFor, reportFor]);

  // Prefetch the next few images so swipes feel instant.
  useEffect(() => {
    cards.slice(0, 4).forEach((c) => {
      if (c.imageUrl) new Image().src = c.imageUrl;
    });
  }, [cards]);

  const applyCategories = (slugs: string[]) => {
    setSelected(slugs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs));
    setShowSheet(false);
    fetchCards(slugs, { reset: true });
  };

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    cards.forEach((card, i) => {
      out.push({ kind: "card", card });
      if ((i + 1) % CHECKIN_EVERY === 0) out.push({ kind: "checkin", afterCount: i + 1 });
    });
    if (exhausted) out.push({ kind: "end" });
    return out;
  }, [cards, exhausted]);

  const scrollNext = () =>
    containerRef.current?.scrollBy({ top: window.innerHeight, behavior: "smooth" });

  const topicLabel =
    selected.length === 0
      ? "Everything"
      : categories
          .filter((c) => selected.includes(c.slug))
          .map((c) => c.icon)
          .join(" ");

  return (
    <div className="relative h-dvh overflow-hidden bg-neutral-950">
      {/* Floating header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between px-4 py-3">
        <Link href="/" className="pointer-events-auto text-lg font-bold drop-shadow">
          ✨ Sparklet
        </Link>
        <div className="pointer-events-auto flex items-center gap-2">
          <span
            className="rounded-full bg-neutral-900/80 px-3 py-1.5 text-sm font-semibold backdrop-blur"
            title="Daily streak"
          >
            🔥 {streak}
          </span>
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="relative rounded-full bg-neutral-900/80 px-3 py-1.5 text-sm backdrop-blur transition hover:bg-neutral-800"
          >
            🔔
            {initialUnread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                {initialUnread > 9 ? "9+" : initialUnread}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setShowSheet(true)}
            className="rounded-full bg-neutral-900/80 px-3 py-1.5 text-sm font-semibold backdrop-blur transition hover:bg-neutral-800"
          >
            {topicLabel} ▾
          </button>
          <Link
            href="/profile"
            aria-label="Profile"
            className="rounded-full bg-neutral-900/80 px-3 py-1.5 text-sm backdrop-blur transition hover:bg-neutral-800"
          >
            👤
          </Link>
        </div>
      </header>

      {/* The feed */}
      <div
        ref={containerRef}
        className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-scroll"
      >
        {items.map((item, i) =>
          item.kind === "card" ? (
            <div key={item.card.id} data-index={cards.indexOf(item.card)} data-card-id={item.card.id}>
              <LearnCard
                card={item.card}
                liked={likes[item.card.id] ?? false}
                commentCount={commentCounts[item.card.id] ?? 0}
                onToggleLike={() => toggleLike(item.card.id)}
                onOpenComments={() => setCommentsFor(item.card)}
                onReport={() => setReportFor(item.card.id)}
              />
            </div>
          ) : item.kind === "checkin" ? (
            <section
              key={`checkin-${i}`}
              className="flex h-dvh snap-start flex-col items-center justify-center gap-4 px-8 text-center"
            >
              <div className="text-5xl">🌱</div>
              <h2 className="text-2xl font-bold">Nice — {sessionViews} cards this session</h2>
              <p className="max-w-sm text-neutral-400">
                That&apos;s roughly {Math.max(1, Math.round((sessionViews * 20) / 60))} minutes of
                learning. Keep going, or come back later — your streak is safe for today.
              </p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={scrollNext}
                  className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
                >
                  Keep going
                </button>
                <Link
                  href="/profile"
                  className="rounded-xl border border-neutral-700 px-6 py-3 font-semibold text-neutral-300 transition hover:border-neutral-500"
                >
                  Take a break
                </Link>
              </div>
            </section>
          ) : (
            <section
              key="end"
              className="flex h-dvh snap-start flex-col items-center justify-center gap-4 px-8 text-center"
            >
              <div className="text-5xl">🎓</div>
              <h2 className="text-2xl font-bold">You&apos;re all caught up</h2>
              <p className="max-w-sm text-neutral-400">
                You&apos;ve seen every card in{" "}
                {selected.length === 0 ? "the whole feed" : "these topics"} — new cards land
                regularly.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowSheet(true)}
                  className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
                >
                  Switch topics
                </button>
                <button
                  type="button"
                  onClick={() => fetchCards(selected, { allowRepeats: true })}
                  className="rounded-xl border border-neutral-700 px-6 py-3 font-semibold text-neutral-300 transition hover:border-neutral-500"
                >
                  Review cards I&apos;ve seen
                </button>
              </div>
            </section>
          )
        )}

        {cards.length === 0 && !exhausted && (
          <div className="flex h-dvh items-center justify-center text-neutral-500">
            {loading ? "Loading your feed…" : "No cards yet — check back soon."}
          </div>
        )}
      </div>

      {showSheet && (
        <CategorySheet
          categories={categories}
          selected={selected}
          onApply={applyCategories}
          onClose={() => setShowSheet(false)}
        />
      )}

      {commentsFor && (
        <CommentsSheet
          cardId={commentsFor.id}
          cardTitle={commentsFor.title}
          onClose={() => setCommentsFor(null)}
          onCountChange={(n) =>
            setCommentCounts((prev) => ({ ...prev, [commentsFor.id]: n }))
          }
        />
      )}

      {reportFor && (
        <ReportSheet target={{ cardId: reportFor }} onClose={() => setReportFor(null)} />
      )}
    </div>
  );
}
