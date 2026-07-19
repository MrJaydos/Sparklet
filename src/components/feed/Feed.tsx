"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedCard, FeedQuiz, FeedGuess } from "@/lib/feed";
import { LearnCard } from "./LearnCard";
import {
  CategorySheet,
  type CategoryOption,
  DAILY_CARD_GOAL_KEY,
  DEFAULT_DAILY_CARD_GOAL,
} from "./CategorySheet";
import { SearchSheet } from "./SearchSheet";
import { MenuSheet } from "./MenuSheet";
import { CommentsSheet } from "./CommentsSheet";
import { ReportSheet } from "./ReportSheet";
import { QuizView } from "./QuizView";
import { GuessView } from "./GuessView";
import { XpRing } from "./XpRing";
import { StreakBadge } from "./StreakBadge";
import { NotificationsBell } from "./NotificationsBell";
import { usePopoverAnchor } from "./usePopoverAnchor";
import { ConfettiBurst, vibrate, type XpInfo } from "./Celebration";
import { PushPrompt } from "./PushPrompt";
import { shareOrCopy } from "@/lib/share";

const CHECKIN_EVERY = 15; // soft session check-in cadence
const STORAGE_KEY = "sparklet.categories";

const QUIZ_EVERY = 5; // roughly 1 recall quiz per 5 cards
// Guess challenges land between quiz slots (offset so they never stack).
const GUESS_EVERY = 8;
const GUESS_OFFSET = 3;

const INVITE_AFTER_CARDS = 12; // show once per qualifying session, after this many cards
const INVITE_SESSION_KEY = "sparklet.inviteSessionCount";
const GOAL_HIT_KEY = "sparklet.goalHit"; // date string — one goal-complete screen per day

type FeedItem =
  | { kind: "card"; card: FeedCard }
  | { kind: "quiz"; quiz: FeedQuiz }
  | { kind: "guess"; guess: FeedGuess }
  | { kind: "checkin"; afterCount: number }
  | { kind: "invite" }
  | { kind: "goalReached" }
  | { kind: "end" };

export function Feed({
  initialCards,
  initialQuizzes,
  initialGuesses,
  initialExhausted,
  categories,
  initialStreak,
  initialLongestStreak,
  initialFreezesAvailable,
  initialUnread,
  initialXpToday,
  dailyGoal,
  initialCardsToday,
  inviteUrl,
  isAdmin,
  isGuest,
  signOutAction,
}: {
  initialCards: FeedCard[];
  initialQuizzes: FeedQuiz[];
  initialGuesses: FeedGuess[];
  initialExhausted: boolean;
  categories: CategoryOption[];
  initialStreak: number;
  initialLongestStreak: number;
  initialFreezesAvailable: number;
  initialUnread: number;
  initialXpToday: number;
  dailyGoal: number;
  initialCardsToday: number;
  inviteUrl: string;
  isAdmin: boolean;
  /** Signed-out visitor: browsing works, everything that writes prompts sign-in. */
  isGuest: boolean;
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const requireAuth = useCallback(
    (reason: "comments" | "save" | "report") => {
      if (!isGuest) return false;
      router.push(`/login?callbackUrl=%2Ffeed&reason=${reason}`);
      return true;
    },
    [isGuest, router]
  );
  const [cards, setCards] = useState<FeedCard[]>(initialCards);
  const [quizzes, setQuizzes] = useState<FeedQuiz[]>(initialQuizzes);
  const [guesses, setGuesses] = useState<FeedGuess[]>(initialGuesses);
  const [exhausted, setExhausted] = useState(initialExhausted);
  const [xpToday, setXpToday] = useState(initialXpToday);
  const [goalCelebration, setGoalCelebration] = useState(false);
  const xpTodayRef = useRef(initialXpToday);
  const [cardsToday, setCardsToday] = useState(initialCardsToday);
  const cardsTodayRef = useRef(initialCardsToday);
  const [dailyCardGoal, setDailyCardGoal] = useState(DEFAULT_DAILY_CARD_GOAL);
  const [cardGoalCelebration, setCardGoalCelebration] = useState(false);
  const [sessionCategories, setSessionCategories] = useState<Set<string>>(new Set());
  const [goalReachedAfter, setGoalReachedAfter] = useState<number | null>(null);
  const sessionViewsRef = useRef(0);
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
  const [longestStreak, setLongestStreak] = useState(initialLongestStreak);
  const [freezesAvailable, setFreezesAvailable] = useState(initialFreezesAvailable);
  const [unread, setUnread] = useState(initialUnread);
  const [showSheet, setShowSheet] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const { triggerRef: searchTriggerRef, anchor: searchAnchor, measure: measureSearchAnchor, clear: clearSearchAnchor } = usePopoverAnchor<HTMLButtonElement>();
  const { triggerRef: topicTriggerRef, anchor: topicAnchor, measure: measureTopicAnchor, clear: clearTopicAnchor } = usePopoverAnchor<HTMLButtonElement>();
  const [showMenu, setShowMenu] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [showInviteCard, setShowInviteCard] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const pushPromptCheckedRef = useRef(false);
  const [commentsFor, setCommentsFor] = useState<FeedCard | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [sessionViews, setSessionViews] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewedRef = useRef<Set<string>>(new Set());
  const readRef = useRef<Set<string>>(new Set()); // cards that hit the read-dwell threshold
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Timezone hint for the server: lets the next server render compute the
  // daily XP window in local time instead of guessing UTC.
  useEffect(() => {
    document.cookie = `sparklet.tz=${new Date().getTimezoneOffset()}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(DAILY_CARD_GOAL_KEY));
      if (Number.isFinite(v) && v > 0) queueMicrotask(() => setDailyCardGoal(v));
    } catch {
      /* private mode — default goal stands */
    }
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
    shareOrCopy({ title: card.title, text: card.title, url }, () => {
      if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
      setSaveNotice("🔗 Link copied — send it to someone");
      saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 1800);
    });
  }, []);

  const inviteFromFeed = useCallback(() => {
    shareOrCopy(
      {
        title: "Sparklet",
        text: "Learn something real, one swipe at a time — join me on Sparklet:",
        url: inviteUrl,
      },
      () => {
        if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
        setSaveNotice("🔗 Link copied — send it to someone");
        saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 1800);
      }
    );
  }, [inviteUrl]);

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

  // Restore saved topic selection (may differ from the server-rendered feed).
  useEffect(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      // Deferred so the restore doesn't force a cascading render mid-hydration.
      queueMicrotask(() => {
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

  // In-feed invite prompt: only on every other session, not every one.
  // Guests have no invite link of their own, so skip it entirely.
  useEffect(() => {
    if (isGuest) return;
    try {
      const n = Number(localStorage.getItem(INVITE_SESSION_KEY) ?? "0") + 1;
      localStorage.setItem(INVITE_SESSION_KEY, String(n));
      queueMicrotask(() => setShowInviteCard(n % 2 === 0));
    } catch {
      /* private mode — just skip the invite card this session */
    }
  }, [isGuest]);

  // One more "thing learned" today — read, review recall, quiz, or guess.
  // Crossing the user's daily goal shows a one-time completion screen,
  // gated by date so it doesn't refire every session once past the goal.
  const markCardCompleted = useCallback(() => {
    cardsTodayRef.current += 1;
    const next = cardsTodayRef.current;
    setCardsToday(next);
    if (next - 1 < dailyCardGoal && next >= dailyCardGoal) {
      const today = new Date().toDateString();
      try {
        if (localStorage.getItem(GOAL_HIT_KEY) !== today) {
          localStorage.setItem(GOAL_HIT_KEY, today);
          setGoalReachedAfter(sessionViewsRef.current);
          setCardGoalCelebration(true);
          vibrate([40, 60, 40, 60, 80]);
          setTimeout(() => setCardGoalCelebration(false), 4000);
        }
      } catch {
        setGoalReachedAfter(sessionViewsRef.current);
        setCardGoalCelebration(true);
        setTimeout(() => setCardGoalCelebration(false), 4000);
      }
    }
  }, [dailyCardGoal]);

  const postView = useCallback(async (cardId: string, dwellMs?: number) => {
    // Guests aren't signed in — nothing to award or persist server-side,
    // and the endpoint would just 401. Skip the round-trip entirely.
    if (isGuest) return;
    try {
      const res = await fetch("/api/interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cardId,
          action: "view",
          ...(dwellMs !== undefined ? { dwellMs } : {}),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        handleXp(data.xp);
        if (data.read) markCardCompleted();
        if (data.streak) {
          setStreak(data.streak.currentStreak);
          setLongestStreak(data.streak.longestStreak);
          setFreezesAvailable(data.streak.freezesAvailable);
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
  }, [handleXp, markCardCompleted, isGuest]);

  // Marks the card as seen (so the feed never repeats it) but earns nothing —
  // XP and streak wait for the read ping below.
  const addSessionCategory = useCallback((name: string | undefined) => {
    if (!name) return;
    setSessionCategories((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);

  const markViewed = useCallback((cardId: string) => {
    if (viewedRef.current.has(cardId)) return;
    viewedRef.current.add(cardId);
    sessionViewsRef.current += 1;
    setSessionViews(sessionViewsRef.current);
    addSessionCategory(cardsRef.current.find((c) => c.id === cardId)?.category.name);
    postView(cardId);
  }, [postView, addSessionCategory]);

  // Read ping: fires once a card has stayed active past the server's read
  // threshold, turning the view into a completed read (XP, streak, demand
  // signal). Swiping away earlier cancels it, so skips stay free.
  const READ_DWELL_MS = 5_200; // slightly over the server's 5s minimum
  const scheduleReadPing = useCallback((cardId: string, activeSince: number) => {
    if (readTimerRef.current) clearTimeout(readTimerRef.current);
    if (readRef.current.has(cardId)) return;
    // Delay counts from when the card became active, so re-arming after an
    // effect re-run (new batch loaded mid-dwell) doesn't restart the clock.
    const delay = Math.max(0, READ_DWELL_MS - (Date.now() - activeSince));
    readTimerRef.current = setTimeout(() => {
      if (activeIdRef.current !== cardId || readRef.current.has(cardId)) return;
      readRef.current.add(cardId);
      postView(cardId, Date.now() - activeSince);
    }, delay);
  }, [postView]);

  // Long-dwell reporting: when the user moves off a card, tell the server
  // how long they lingered (enters spaced repetition when unusually long).
  const activeSinceRef = useRef<number>(0);
  const reportDwell = useCallback((cardId: string, dwellMs: number) => {
    if (isGuest || dwellMs < 12_000) return; // server threshold prefilter
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
  }, [isGuest]);

  const toggleSave = useCallback((cardId: string) => {
    if (requireAuth("save")) return;
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
  }, [requireAuth]);

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
              scheduleReadPing(id, activeSinceRef.current);
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
    // Re-arm the active card's read ping: the cleanup below cancels it when
    // this effect re-runs (e.g. a new batch arrives mid-dwell).
    if (activeIdRef.current && !readRef.current.has(activeIdRef.current)) {
      scheduleReadPing(activeIdRef.current, activeSinceRef.current);
    }
    return () => {
      observer.disconnect();
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    };
  }, [cards, selected, exhausted, markViewed, fetchCards, reportDwell, scheduleReadPing]);

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
  // Soft-ask for push reminders after a few real swipes — never on first
  // paint, and not again for a fortnight after a "Not now".
  useEffect(() => {
    if (isGuest || sessionViews < 3 || pushPromptCheckedRef.current) return;
    pushPromptCheckedRef.current = true;
    (async () => {
      try {
        const dismissedAt = Number(localStorage.getItem("sparklet.pushAskedAt") ?? 0);
        if (Date.now() - dismissedAt < 14 * 86_400_000) return;
        const { getPushState } = await import("@/lib/push-client");
        if ((await getPushState()) === "ready") setShowPushPrompt(true);
      } catch {
        /* private mode / unsupported */
      }
    })();
  }, [sessionViews, isGuest]);
  const closePushPrompt = useCallback((enabled: boolean) => {
    setShowPushPrompt(false);
    try {
      // Remember the ask either way; an enabled subscription hides future
      // prompts via getPushState() anyway.
      localStorage.setItem("sparklet.pushAskedAt", String(Date.now()));
    } catch {
      /* private mode */
    }
    if (enabled) {
      if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
      setSaveNotice("🔔 Reminders on — we'll nudge you when it matters.");
      saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 5000);
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
    // Keep persisted interests (nudge targeting, new-user boost) in sync with
    // whatever the user actually filters the feed to, not just onboarding.
    if (slugs.length && !isGuest) {
      fetch("/api/interests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categorySlugs: slugs }),
      }).catch(() => {});
    }
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
      // Check-in's recap CTAs (share via inviteUrl, "take a break" → /profile)
      // and the invite card both assume a signed-in account — skip for guests
      // rather than dead-ending them at a login wall mid-scroll.
      if (!isGuest && (i + 1) % CHECKIN_EVERY === 0) out.push({ kind: "checkin", afterCount: i + 1 });
      if (!isGuest && showInviteCard && i + 1 === INVITE_AFTER_CARDS) out.push({ kind: "invite" });
      if (goalReachedAfter !== null && i + 1 === goalReachedAfter) out.push({ kind: "goalReached" });
    });
    if (exhausted) out.push({ kind: "end" });
    return out;
  }, [cards, quizzes, guesses, exhausted, showInviteCard, goalReachedAfter, isGuest]);

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
            ref={topicTriggerRef}
            type="button"
            onClick={() => {
              measureTopicAnchor();
              setShowSheet(true);
            }}
            className="min-w-0 max-w-28 truncate rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:max-w-40"
          >
            {topicLabel} ▾
          </button>
          {!isGuest && (
            <>
              <StreakBadge
                streak={streak}
                longestStreak={longestStreak}
                freezesAvailable={freezesAvailable}
              />
              <XpRing today={xpToday} goal={dailyGoal} />
            </>
          )}
          <button
            ref={searchTriggerRef}
            type="button"
            onClick={() => {
              measureSearchAnchor();
              setShowSearch(true);
            }}
            className="hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
          >
            🔍 Search
          </button>
          {isGuest ? (
            <Link
              href="/login?callbackUrl=%2Ffeed"
              className="whitespace-nowrap rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
            >
              Sign in
            </Link>
          ) : (
            <>
              <NotificationsBell unread={unread} onOpened={setUnread} />
              <Link
                href="/leaderboard"
                className="hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
              >
                🏆 Leaderboard
              </Link>
              <Link
                href="/profile"
                className="hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
              >
                👤 Profile
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
                >
                  🛠️ Admin
                </Link>
              )}
              <form action={signOutAction} className="hidden sm:block">
                <button
                  type="submit"
                  className="whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800"
                >
                  🚪 Sign out
                </button>
              </form>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowMenu(true)}
            aria-label="Menu"
            className="relative rounded-full bg-neutral-900/80 px-2.5 py-1.5 text-xs backdrop-blur transition hover:bg-neutral-800 sm:hidden"
          >
            ☰
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
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
                onToggleSave={() => toggleSave(item.card.id)}
                onOpenComments={() => {
                  if (requireAuth("comments")) return;
                  setCommentsFor(item.card);
                }}
                onReport={() => {
                  if (requireAuth("report")) return;
                  setReportFor(item.card.id);
                }}
                onShare={() => shareCard(item.card)}
              />
            </div>
          ) : item.kind === "quiz" ? (
            <QuizView
              key={`quiz-${item.quiz.id}`}
              quiz={item.quiz}
              isGuest={isGuest}
              onContinue={scrollNext}
              onResult={(r) => {
                handleXp(r.xp);
                if (!isGuest) markCardCompleted();
                addSessionCategory(item.quiz.category.name);
              }}
            />
          ) : item.kind === "guess" ? (
            <GuessView
              key={`guess-${item.guess.id}`}
              guess={item.guess}
              isGuest={isGuest}
              onContinue={scrollNext}
              onResult={(r) => {
                handleXp(r.xp);
                if (!isGuest) markCardCompleted();
                addSessionCategory(item.guess.category.name);
              }}
            />
          ) : item.kind === "invite" ? (
            <section
              key="invite"
              className="flex h-dvh snap-start flex-col items-center justify-center gap-4 px-8 text-center"
            >
              <div className="text-5xl">🎁</div>
              <h2 className="text-2xl font-bold">Know someone who&apos;d love this?</h2>
              <p className="max-w-sm text-neutral-400">
                Invite a friend to Sparklet — you&apos;ll earn a bonus 🧊 streak freeze when they
                join.
              </p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={inviteFromFeed}
                  className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
                >
                  Invite a friend
                </button>
                <button
                  type="button"
                  onClick={scrollNext}
                  className="rounded-xl border border-neutral-700 px-6 py-3 font-semibold text-neutral-300 transition hover:border-neutral-500"
                >
                  Maybe later
                </button>
              </div>
            </section>
          ) : item.kind === "checkin" ? (
            <section
              key={`checkin-${i}`}
              className="flex h-dvh snap-start flex-col items-center justify-center gap-4 px-8 text-center"
            >
              <div className="text-5xl">🌱</div>
              <h2 className="text-2xl font-bold">
                You&apos;ve learned {sessionViews} thing{sessionViews === 1 ? "" : "s"} across{" "}
                {sessionCategories.size} topic{sessionCategories.size === 1 ? "" : "s"}
              </h2>
              <p className="max-w-sm text-neutral-400">
                Keep going, or come back later — your streak is safe for today.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={scrollNext}
                  className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
                >
                  Keep going
                </button>
                <button
                  type="button"
                  onClick={() =>
                    shareOrCopy(
                      {
                        title: "Sparklet",
                        text: `I just learned ${sessionViews} thing${sessionViews === 1 ? "" : "s"} across ${sessionCategories.size} topic${sessionCategories.size === 1 ? "" : "s"} on Sparklet ✨`,
                        url: inviteUrl,
                      },
                      () => {
                        setSaveNotice("Recap copied!");
                        if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
                        saveNoticeTimer.current = setTimeout(() => setSaveNotice(null), 1800);
                      }
                    )
                  }
                  className="rounded-xl border border-neutral-700 px-6 py-3 font-semibold text-neutral-300 transition hover:border-neutral-500"
                >
                  Share recap
                </button>
                <Link
                  href="/profile"
                  className="rounded-xl border border-neutral-700 px-6 py-3 font-semibold text-neutral-300 transition hover:border-neutral-500"
                >
                  Take a break
                </Link>
              </div>
            </section>
          ) : item.kind === "goalReached" ? (
            <section
              key="goal-reached"
              className="flex h-dvh snap-start flex-col items-center justify-center gap-4 px-8 text-center"
            >
              <div className="text-6xl">🏁</div>
              <h2 className="text-3xl font-bold">Daily goal complete!</h2>
              <p className="max-w-sm text-neutral-400">
                {cardsToday} cards today — you hit your goal of {dailyCardGoal}. That&apos;s{" "}
                {sessionViews} this session across {sessionCategories.size} topic
                {sessionCategories.size === 1 ? "" : "s"}. Ending on purpose beats endless
                scrolling.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={scrollNext}
                  className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
                >
                  Keep going anyway
                </button>
                <Link
                  href="/profile"
                  className="rounded-xl border border-neutral-700 px-6 py-3 font-semibold text-neutral-300 transition hover:border-neutral-500"
                >
                  Done for today
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
                  onClick={() => {
                    measureTopicAnchor();
                    setShowSheet(true);
                  }}
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
          <div className="flex h-dvh flex-col items-center justify-center gap-3 text-neutral-500">
            {loading ? (
              <>
                <div className="animate-bounce text-4xl">✨</div>
                <span className="text-sm font-medium">Shuffling your feed…</span>
              </>
            ) : (
              "No cards yet — check back soon."
            )}
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

      {/* First-visit swipe hint: an animated upward flick + call to action */}
      {showSwipeHint && cards.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-40 flex flex-col items-center">
          <div className="relative flex h-28 items-end justify-center" aria-hidden>
            <div className="swipe-trail absolute bottom-6 h-16 w-1.5 rounded-full bg-gradient-to-t from-white/0 via-white/40 to-white/0" />
            <div className="swipe-hand text-5xl drop-shadow-lg">👆</div>
          </div>
          <span className="rounded-full bg-violet-600 px-6 py-3 text-base font-bold text-white shadow-xl shadow-violet-600/30">
            Start swiping to learn
          </span>
        </div>
      )}

      {showMenu && (
        <MenuSheet
          unread={unread}
          inviteUrl={inviteUrl}
          isAdmin={isAdmin}
          isGuest={isGuest}
          signOutAction={signOutAction}
          onClose={() => setShowMenu(false)}
          onSearch={() => {
            setShowMenu(false);
            clearSearchAnchor();
            setShowSearch(true);
          }}
        />
      )}

      {showSearch && (
        <SearchSheet onClose={() => setShowSearch(false)} anchor={searchAnchor} />
      )}

      {showSheet && (
        <CategorySheet
          categories={categories}
          selected={selected}
          onApply={applyCategories}
          onClose={() => {
            setShowSheet(false);
            clearTopicAnchor();
          }}
          onGoalChange={setDailyCardGoal}
          anchor={topicAnchor}
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

      {cardGoalCelebration && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <ConfettiBurst big />
        </div>
      )}

      {freezeNotice && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center px-4">
          <div className="rounded-xl border border-sky-800 bg-sky-950/95 px-4 py-3 text-sm text-sky-200 shadow-lg backdrop-blur">
            {freezeNotice}
          </div>
        </div>
      )}

      {showPushPrompt && <PushPrompt onDone={closePushPrompt} />}

      {saveNotice && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3rem)] z-50 flex justify-center px-4">
          <div className="rounded-full border border-amber-800 bg-neutral-900/95 px-4 py-2 text-sm text-amber-200 shadow-lg backdrop-blur">
            {saveNotice}
          </div>
        </div>
      )}
    </div>
  );
}
