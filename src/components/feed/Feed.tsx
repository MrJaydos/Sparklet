"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedCard, FeedQuiz, FeedGuess } from "@/lib/feed";
import { LearnCard } from "./LearnCard";
import { CategorySheet, type CategoryOption } from "./CategorySheet";
import { SearchSheet } from "./SearchSheet";
import { MenuSheet } from "./MenuSheet";
import { CommentsSheet } from "./CommentsSheet";
import { ReportSheet } from "./ReportSheet";
import { QuizView } from "./QuizView";
import { GuessView } from "./GuessView";
import { XpRing } from "./XpRing";
import { ConfettiBurst, vibrate, type XpInfo } from "./Celebration";

const CHECKIN_EVERY = 15; // soft session check-in cadence
const STORAGE_KEY = "sparklet.categories";

const QUIZ_EVERY = 5; // roughly 1 recall quiz per 5 cards
// Guess challenges land between quiz slots (offset so they never stack).
const GUESS_EVERY = 8;
const GUESS_OFFSET = 3;

type FeedItem =
  | { kind: "card"; card: FeedCard }
  | { kind: "quiz"; quiz: FeedQuiz }
  | { kind: "guess"; guess: FeedGuess }
  | { kind: "checkin"; afterCount: number }
  | { kind: "end" };

export function Feed({
  initialCards,
  initialQuizzes,
  initialGuesses,
  initialExhausted,
  categories,
  initialStreak,
  initialUnread,
  initialXpToday,
  dailyGoal,
}: {
  initialCards: FeedCard[];
  initialQuizzes: FeedQuiz[];
  initialGuesses: FeedGuess[];
  initialExhausted: boolean;
  categories: CategoryOption[];
  initialStreak: number;
  initialUnread: number;
  initialXpToday: number;
  dailyGoal: number;
}) {
  const [cards, setCards] = useState<FeedCard[]>(initialCards);
  const [quizzes, setQuizzes] = useState<FeedQuiz[]>(initialQuizzes);
  const [guesses, setGuesses] = useState<FeedGuess[]>(initialGuesses);
  const [exhausted, setExhausted] = useState(initialExhausted);
  const [xpToday, setXpToday] = useState(initialXpToday);
  const [goalCelebration, setGoalCelebration] = useState(false);
  const xpTodayRef = useRef(initialXpToday);
  const [selected, setSelected] = useState<string[]>([]);
  const [saves, setSaves] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialCards.map((c) => [c.id, c.saved]))
  );
  const [freezeNotice, setFreezeNotice] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const saveNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialCards.map((c) => [c.id, c.commentCount]))
  );
  const [streak, setStreak] = useState(initialStreak);
  const [showSheet, setShowSheet] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [commentsFor, setCommentsFor] = useState<FeedCard | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [sessionViews, setSessionViews] = useState(0);
  const [loading, setLoading] = useState(false);
  const [autoRead, setAutoRead] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewedRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const autoReadRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Pick the most natural English voice the device offers. Platforms bury
  // their good voices behind getVoices(): Edge's "Natural", Chrome's
  // network "Google" voices, iOS "Enhanced"/"Premium" — the default is
  // usually the robotic one.
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const pick = () => {
      const voices = window.speechSynthesis
        .getVoices()
        .filter((v) => v.lang.toLowerCase().startsWith("en"));
      if (!voices.length) return;
      const pref = (navigator.language || "en").toLowerCase();
      const score = (v: SpeechSynthesisVoice) => {
        const n = v.name.toLowerCase();
        const locale = v.lang.toLowerCase();
        let s = 0;
        if (n.includes("natural") || n.includes("neural")) s += 8;
        if (n.includes("premium")) s += 6;
        if (n.includes("enhanced")) s += 5;
        if (n.includes("google")) s += 4;
        if (!v.localService) s += 2; // network voices usually sound better
        if (locale === pref) s += 3;
        else if (/^en-(nz|au|gb)/.test(locale)) s += 1;
        if (v.default) s += 1;
        return s;
      };
      voiceRef.current = [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
    };
    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);

  const browserSpeak = useCallback((card: FeedCard) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${card.title}. ${card.body}`);
    if (voiceRef.current) {
      u.voice = voiceRef.current;
      u.lang = voiceRef.current.lang;
    } else {
      u.lang = "en";
    }
    u.rate = 1.05;
    const clear = () => setSpeakingId((id) => (id === card.id ? null : id));
    u.onend = clear;
    u.onerror = clear;
    window.speechSynthesis.speak(u);
    setSpeakingId(card.id);
  }, []);

  // Narration: server-side Piper audio (natural, same voice everywhere,
  // cached per card) with browser speechSynthesis as the fallback.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speakCard = useCallback(
    (card: FeedCard) => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      const a = audioRef.current ?? (audioRef.current = new Audio());
      a.onerror = null; // don't let aborting the previous track trigger fallback
      a.pause();
      let fellBack = false;
      const fallback = () => {
        if (fellBack) return;
        fellBack = true;
        browserSpeak(card);
      };
      const clear = () => setSpeakingId((id) => (id === card.id ? null : id));
      a.src = `/api/cards/${card.id}/audio`;
      a.onended = clear;
      a.onerror = fallback;
      setSpeakingId(card.id);
      a.play().catch(fallback);
    },
    [browserSpeak]
  );

  const stopSpeech = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onerror = null;
      audioRef.current.pause();
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  // Never leave speech running after leaving the feed.
  useEffect(() => stopSpeech, [stopSpeech]);

  // Timezone hint for the server: lets the next server render compute the
  // daily XP window in local time instead of guessing UTC.
  useEffect(() => {
    document.cookie = `sparklet.tz=${new Date().getTimezoneOffset()}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // XP flows back from every interaction/answer; crossing the daily goal
  // gets one big celebration per session. Always adopt the server's value:
  // it's computed with the client's real timezone, unlike the server-rendered
  // initial (UTC guess), which may start too high — clamping to the max would
  // freeze the ring until real XP catches the inflated number.
  const handleXp = useCallback(
    (xp: XpInfo | undefined) => {
      if (!xp) return;
      const prev = xpTodayRef.current;
      const next = xp.today;
      xpTodayRef.current = next;
      setXpToday(next);
      if (prev < dailyGoal && next >= dailyGoal) {
        setGoalCelebration(true);
        vibrate([40, 60, 40, 60, 80]);
        setTimeout(() => setGoalCelebration(false), 4000);
      }
    },
    [dailyGoal]
  );

  // Share a card: native sheet where available, clipboard everywhere else.
  const shareCard = useCallback((card: FeedCard) => {
    const url = `${window.location.origin}/card/${card.id}`;
    if (navigator.share) {
      navigator.share({ title: card.title, text: card.title, url }).catch(() => {});
      return;
    }
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
        setSaveNotice("🔗 Link copied — send it to someone");
        saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 1800);
      })
      .catch(() => {});
  }, []);

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
        const data: {
          cards: FeedCard[];
          quizzes: FeedQuiz[];
          guesses: FeedGuess[];
          exhausted: boolean;
        } = await res.json();
        setSaves((prev) => ({
          ...Object.fromEntries(data.cards.map((c) => [c.id, c.saved])),
          ...(opts?.reset ? {} : prev),
        }));
        setCommentCounts((prev) => ({
          ...Object.fromEntries(data.cards.map((c) => [c.id, c.commentCount])),
          ...(opts?.reset ? {} : prev),
        }));
        setCards((prev) => (opts?.reset ? data.cards : [...prev, ...data.cards]));
        setQuizzes((prev) => {
          const base = opts?.reset ? [] : prev;
          const known = new Set(base.map((q) => q.id));
          return [...base, ...data.quizzes.filter((q) => !known.has(q.id))];
        });
        setGuesses((prev) => {
          const base = opts?.reset ? [] : prev;
          const known = new Set(base.map((g) => g.id));
          return [...base, ...data.guesses.filter((g) => !known.has(g.id))];
        });
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

  // Restore saved topic selection (may differ from the server-rendered feed)
  // and the auto-read preference.
  useEffect(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      const savedAutoRead = localStorage.getItem("sparklet.autoread") === "true";
      // Deferred so the restore doesn't force a cascading render mid-hydration.
      queueMicrotask(() => {
        if (savedAutoRead) {
          autoReadRef.current = true;
          setAutoRead(true);
        }
        if (saved.length) {
          setSelected(saved);
          fetchCards(saved, { reset: true });
        }
      });
    } catch {
      /* ignore corrupt storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAutoRead = () => {
    const next = !autoRead;
    setAutoRead(next);
    autoReadRef.current = next;
    localStorage.setItem("sparklet.autoread", String(next));
    if (next) {
      const active = cardsRef.current.find((c) => c.id === activeIdRef.current);
      if (active) speakCard(active);
    } else {
      stopSpeech();
    }
  };

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
        handleXp(data.xp);
        if (data.streak) {
          setStreak(data.streak.currentStreak);
          if (data.streak.freezesUsed > 0) {
            setFreezeNotice(
              `🧊 A streak freeze covered ${
                data.streak.freezesUsed === 1 ? "yesterday" : `${data.streak.freezesUsed} missed days`
              } — your ${data.streak.currentStreak}-day streak is intact. ${data.streak.freezesAvailable} freeze${data.streak.freezesAvailable === 1 ? "" : "s"} left this month.`
            );
            setTimeout(() => setFreezeNotice(null), 8000);
          }
        }
      }
    } catch {
      /* non-fatal */
    }
  }, [handleXp]);

  // Long-dwell reporting: when the user moves off a card, tell the server
  // how long they lingered (enters spaced repetition when unusually long).
  const activeSinceRef = useRef<number>(0);
  const reportDwell = useCallback((cardId: string, dwellMs: number) => {
    if (dwellMs < 12_000) return; // server threshold prefilter
    fetch("/api/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cardId,
        action: "view",
        dwellMs,
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      }),
    }).catch(() => {});
  }, []);

  const toggleSave = useCallback((cardId: string) => {
    setSaves((prev) => {
      const saved = !prev[cardId];
      fetch(`/api/cards/${cardId}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saved }),
      }).catch(() => {});
      if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
      setSaveNotice(saved ? "🔖 Saved to your notebook" : "Removed from notebook");
      saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 1800);
      return { ...prev, [cardId]: saved };
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
          if (id) {
            markViewed(id);
            if (id !== activeIdRef.current) {
              if (activeIdRef.current) {
                reportDwell(activeIdRef.current, Date.now() - activeSinceRef.current);
              }
              activeIdRef.current = id;
              activeSinceRef.current = Date.now();
              if (autoReadRef.current) {
                const card = cardsRef.current.find((c) => c.id === id);
                if (card) speakCard(card);
              }
            }
          }
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
  }, [cards, selected, exhausted, markViewed, fetchCards, speakCard, reportDwell]);

  // Wheel navigation for desktop: with mandatory snap, a single wheel tick
  // scrolls a few pixels and snaps straight back — feels dead. Treat each
  // wheel gesture as "advance one card", accumulating small trackpad deltas
  // and locking briefly to swallow the gesture's momentum tail.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let locked = false;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      // Don't page the feed underneath an open image lightbox.
      if ((e.target as HTMLElement | null)?.closest?.("[data-lightbox]")) return;
      // Long-form card text scrolls natively; only hijack once it's exhausted.
      const inner = (e.target as HTMLElement | null)?.closest?.("[data-wheel-scroll]");
      if (inner && inner.scrollHeight > inner.clientHeight) {
        const atTop = inner.scrollTop <= 0 && e.deltaY < 0;
        const atBottom =
          inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return;
      }
      e.preventDefault();
      if (locked) return;
      // deltaMode: 0 = pixels, 1 = lines, 2 = pages (Firefox uses lines).
      acc += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1);
      if (Math.abs(acc) < 50) return;
      locked = true;
      const dir = Math.sign(acc);
      acc = 0;
      container.scrollBy({ top: dir * window.innerHeight, behavior: "smooth" });
      setTimeout(() => {
        locked = false;
      }, 700);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard navigation for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== " ") return;
      if (showSheet || showSearch || showMenu || commentsFor || reportFor) return;
      if (document.querySelector("[data-lightbox]")) return;
      e.preventDefault();
      containerRef.current?.scrollBy({
        top: (e.key === "ArrowUp" ? -1 : 1) * window.innerHeight,
        behavior: "smooth",
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSheet, showSearch, showMenu, commentsFor, reportFor]);

  // One-time swipe hint for brand-new visitors; dismissed by the first scroll.
  useEffect(() => {
    try {
      if (!localStorage.getItem("sparklet.hinted")) {
        queueMicrotask(() => setShowSwipeHint(true));
      }
    } catch {
      /* private mode */
    }
  }, []);
  const dismissSwipeHint = useCallback(() => {
    setShowSwipeHint(false);
    try {
      localStorage.setItem("sparklet.hinted", "1");
    } catch {
      /* private mode */
    }
  }, []);

  // Prefetch each incoming batch's images so swipes feel instant — and so
  // the service worker has them cached before a connection drop.
  useEffect(() => {
    cards.slice(-10).forEach((c) => {
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
    let quizCursor = 0;
    let guessCursor = 0;
    cards.forEach((card, i) => {
      out.push({ kind: "card", card });
      if ((i + 1) % QUIZ_EVERY === 0 && quizCursor < quizzes.length) {
        out.push({ kind: "quiz", quiz: quizzes[quizCursor++] });
      }
      if ((i + 1) % GUESS_EVERY === GUESS_OFFSET && guessCursor < guesses.length) {
        out.push({ kind: "guess", guess: guesses[guessCursor++] });
      }
      if ((i + 1) % CHECKIN_EVERY === 0) out.push({ kind: "checkin", afterCount: i + 1 });
    });
    if (exhausted) out.push({ kind: "end" });
    return out;
  }, [cards, quizzes, guesses, exhausted]);

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
      <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-2 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.625rem)]">
        <Link
          href="/"
          className="pointer-events-auto shrink-0 whitespace-nowrap text-base font-bold drop-shadow sm:text-lg"
        >
          ✨ Sparklet
        </Link>
        <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowSheet(true)}
            className="min-w-0 max-w-28 truncate rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:max-w-40"
          >
            {topicLabel} ▾
          </button>
          <span
            className="whitespace-nowrap rounded-full bg-neutral-900/80 px-2.5 py-1.5 text-xs font-semibold backdrop-blur"
            title="Daily streak"
          >
            🔥 {streak}
          </span>
          <XpRing today={xpToday} goal={dailyGoal} />
          <button
            type="button"
            onClick={() => setShowSearch(true)}
            className="hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
          >
            🔍 Search
          </button>
          <Link
            href="/notifications"
            className="relative hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
          >
            🔔 Notifications
            {initialUnread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                {initialUnread > 9 ? "9+" : initialUnread}
              </span>
            )}
          </Link>
          <Link
            href="/profile"
            className="hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
          >
            👤 Profile
          </Link>
          <button
            type="button"
            onClick={() => setShowMenu(true)}
            aria-label="Menu"
            className="relative rounded-full bg-neutral-900/80 px-2.5 py-1.5 text-xs backdrop-blur transition hover:bg-neutral-800 sm:hidden"
          >
            ☰
            {initialUnread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                {initialUnread > 9 ? "9+" : initialUnread}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* The feed */}
      <div
        ref={containerRef}
        onScroll={showSwipeHint ? dismissSwipeHint : undefined}
        className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-scroll"
      >
        {items.map((item, i) =>
          item.kind === "card" ? (
            <div key={item.card.id} data-index={cards.indexOf(item.card)} data-card-id={item.card.id}>
              <LearnCard
                card={item.card}
                saved={saves[item.card.id] ?? false}
                commentCount={commentCounts[item.card.id] ?? 0}
                speaking={speakingId === item.card.id}
                onToggleSpeak={() =>
                  speakingId === item.card.id ? stopSpeech() : speakCard(item.card)
                }
                onToggleSave={() => toggleSave(item.card.id)}
                onOpenComments={() => setCommentsFor(item.card)}
                onReport={() => setReportFor(item.card.id)}
                onShare={() => shareCard(item.card)}
              />
            </div>
          ) : item.kind === "quiz" ? (
            <QuizView
              key={`quiz-${item.quiz.id}`}
              quiz={item.quiz}
              onContinue={scrollNext}
              onResult={(r) => handleXp(r.xp)}
            />
          ) : item.kind === "guess" ? (
            <GuessView
              key={`guess-${item.guess.id}`}
              guess={item.guess}
              onContinue={scrollNext}
              onResult={(r) => handleXp(r.xp)}
            />
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

      {/* Prev/next for mouse users — touch swipes and arrow keys cover the rest */}
      <div className="absolute right-3 top-1/3 z-30 hidden -translate-y-1/2 flex-col gap-2 pointer-fine:flex">
        <button
          type="button"
          aria-label="Previous card"
          onClick={() =>
            containerRef.current?.scrollBy({ top: -window.innerHeight, behavior: "smooth" })
          }
          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900/70 text-neutral-300 backdrop-blur transition hover:bg-neutral-800 hover:text-white"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Next card"
          onClick={scrollNext}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900/70 text-neutral-300 backdrop-blur transition hover:bg-neutral-800 hover:text-white"
        >
          ↓
        </button>
      </div>

      {/* First-visit swipe hint */}
      {showSwipeHint && cards.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 flex flex-col items-center gap-1">
          <div className="animate-bounce text-4xl drop-shadow" aria-hidden>
            👆
          </div>
          <span className="rounded-full bg-neutral-900/85 px-4 py-1.5 text-sm text-neutral-200 backdrop-blur">
            Swipe up for the next card
          </span>
        </div>
      )}

      {showMenu && (
        <MenuSheet
          unread={initialUnread}
          onClose={() => setShowMenu(false)}
          onSearch={() => {
            setShowMenu(false);
            setShowSearch(true);
          }}
        />
      )}

      {showSearch && <SearchSheet onClose={() => setShowSearch(false)} />}

      {showSheet && (
        <CategorySheet
          categories={categories}
          selected={selected}
          onApply={applyCategories}
          onClose={() => setShowSheet(false)}
          autoRead={autoRead}
          onToggleAutoRead={toggleAutoRead}
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

      {goalCelebration && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <ConfettiBurst big />
          <div className="rounded-2xl border border-amber-700 bg-neutral-950/95 px-8 py-6 text-center shadow-2xl backdrop-blur">
            <div className="text-4xl">⚡</div>
            <div className="mt-2 text-xl font-bold text-amber-300">Daily goal reached!</div>
            <div className="mt-1 text-sm text-neutral-400">
              {dailyGoal} XP today — everything from here is a bonus.
            </div>
          </div>
        </div>
      )}

      {freezeNotice && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center px-4">
          <div className="rounded-xl border border-sky-800 bg-sky-950/95 px-4 py-3 text-sm text-sky-200 shadow-lg backdrop-blur">
            {freezeNotice}
          </div>
        </div>
      )}

      {saveNotice && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 flex justify-center px-4">
          <div className="rounded-full border border-amber-800 bg-neutral-900/95 px-4 py-2 text-sm text-amber-200 shadow-lg backdrop-blur">
            {saveNotice}
          </div>
        </div>
      )}
    </div>
  );
}
