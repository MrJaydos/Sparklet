"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CardImage } from "@/components/CardImage";

type QueueCard = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  reviewNote: string | null;
  modelUsed: string | null;
  sources: unknown;
  category: { name: string; icon: string; colorHex: string };
};

const SWIPE_THRESHOLD = 100;

function parseSources(sources: unknown): { title: string; publisher: string; url: string }[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter(
    (s): s is { title: string; publisher: string; url: string } =>
      !!s && typeof s === "object" && "url" in s
  );
}

export function ModerationSwiperLauncher({ cards }: { cards: QueueCard[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (cards.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
      >
        🃏 Swipe mode
      </button>
      {open && (
        <ModerationSwiper
          initialCards={cards}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ModerationSwiper({
  initialCards,
  onClose,
}: {
  initialCards: QueueCard[];
  onClose: () => void;
}) {
  const [cards, setCards] = useState(initialCards);
  const [dragX, setDragX] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; startedOn: HTMLElement | null } | null>(null);

  const current = cards[0];
  const next = cards[1];
  const total = initialCards.length;
  const done = total - cards.length;

  const act = async (action: "publish" | "delete") => {
    if (!current || busy) return;
    setBusy(true);
    setDragX(0);
    setError(null);
    try {
      const res = await fetch(`/api/admin/review/${current.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setCards((c) => c.slice(1));
    } catch {
      // Card stays in the queue so it isn't silently skipped — retry the
      // same card rather than advancing past a failed write.
      setError("That didn't save — try again.");
    }
    setBusy(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [data-lightbox]")) return;
    dragRef.current = { x: e.clientX, startedOn: target };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setDragX(Math.max(-260, Math.min(260, e.clientX - dragRef.current.x)));
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (Math.abs(dragX) >= SWIPE_THRESHOLD) {
      act(dragX > 0 ? "publish" : "delete");
    } else {
      setDragX(0);
    }
  };

  const rotation = dragX / 18;
  const publishOpacity = Math.min(1, Math.max(0, dragX / SWIPE_THRESHOLD));
  const deleteOpacity = Math.min(1, Math.max(0, -dragX / SWIPE_THRESHOLD));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Moderation swiper"
      className="fixed inset-0 z-50 flex flex-col bg-neutral-950/98 backdrop-blur"
    >
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <span className="text-sm font-semibold text-neutral-400">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : current ? (
            `${done + 1} of ${total}`
          ) : (
            `${total} of ${total}`
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close swipe mode"
          className="rounded-full bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition hover:bg-neutral-700"
        >
          ✕ Close
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-5 py-6">
        {!current ? (
          <div className="text-center">
            <p className="text-4xl">🎉</p>
            <p className="mt-3 text-lg font-semibold">Queue clear</p>
            <p className="mt-1 text-sm text-neutral-500">Nothing else is waiting for review.</p>
          </div>
        ) : (
          <div className="relative h-full w-full max-w-md">
            {next && (
              <div className="absolute inset-0 scale-[0.96] rounded-2xl border border-neutral-800 bg-neutral-900 opacity-60" />
            )}

            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                transform: `translateX(${dragX}px) rotate(${rotation}deg)`,
                transition: dragX === 0 ? "transform 200ms ease-out" : "none",
              }}
              className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl"
            >
              <div
                className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border-2 border-emerald-400 px-3 py-1 text-sm font-bold text-emerald-400"
                style={{ opacity: publishOpacity }}
              >
                PUBLISH
              </div>
              <div
                className="pointer-events-none absolute right-4 top-4 z-10 rounded-lg border-2 border-red-400 px-3 py-1 text-sm font-bold text-red-400"
                style={{ opacity: deleteOpacity }}
              >
                DELETE
              </div>

              <div className="flex-1 overflow-y-auto">
                {current.imageUrl && (
                  <div className="h-48 shrink-0">
                    <CardImage src={current.imageUrl} className="h-full" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span
                      className="rounded-full px-2 py-0.5 font-semibold"
                      style={{
                        backgroundColor: `${current.category.colorHex}33`,
                        color: current.category.colorHex,
                      }}
                    >
                      {current.category.icon} {current.category.name}
                    </span>
                    {current.modelUsed && <span>{current.modelUsed}</span>}
                  </div>
                  <h3 className="mt-2 text-lg font-bold leading-snug">{current.title}</h3>
                  <p className="mt-2 whitespace-pre-line text-sm text-neutral-300">{current.body}</p>
                  {current.reviewNote && (
                    <p className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-400">
                      ⚠ {current.reviewNote}
                    </p>
                  )}
                  {parseSources(current.sources).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {parseSources(current.sources).map((s) => (
                        <a
                          key={s.url}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
                        >
                          🔗 {s.publisher}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {current && (
        <div className="flex items-center justify-center gap-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => act("delete")}
            aria-label="Delete card"
            className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-red-500/60 bg-neutral-900 text-2xl text-red-400 transition active:scale-90 disabled:opacity-40"
          >
            ✕
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act("publish")}
            aria-label="Publish anyway"
            className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-emerald-500/60 bg-neutral-900 text-2xl text-emerald-400 transition active:scale-90 disabled:opacity-40"
          >
            ✓
          </button>
        </div>
      )}
    </div>
  );
}
