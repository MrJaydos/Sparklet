"use client";

import { useEffect, useRef, useState } from "react";
import { ReportSheet } from "./ReportSheet";

export type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  mine: boolean;
};

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function CommentsPanel({
  cardId,
  onCountChange,
}: {
  cardId: string;
  onCountChange?: (n: number) => void;
}) {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cards/${cardId}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((data) => {
        if (!cancelled) setComments(data.comments);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const post = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/cards/${cardId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setComments((prev) => {
          const next = [...(prev ?? []), comment];
          onCountChange?.(next.length);
          return next;
        });
        setDraft("");
        setTimeout(() => listRef.current?.scrollTo({ top: 1e6, behavior: "smooth" }), 50);
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {comments === null ? (
          <p className="py-6 text-center text-sm text-neutral-500">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            No comments yet — start the conversation.
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-xl bg-neutral-900 px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-400">
                  {c.author}
                  {c.mine && <span className="ml-1 text-violet-400">(you)</span>}
                </span>
                <span className="flex items-center gap-2 text-xs text-neutral-600">
                  {timeAgo(c.createdAt)}
                  {!c.mine && (
                    <button
                      type="button"
                      onClick={() => setReporting(c.id)}
                      aria-label="Report comment"
                      className="opacity-60 transition hover:opacity-100"
                      title="Report"
                    >
                      ⚑
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-200">{c.body}</p>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              post();
            }
          }}
          maxLength={500}
          placeholder="Add a comment…"
          className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none focus:border-violet-500"
        />
        <button
          type="button"
          onClick={post}
          disabled={!draft.trim() || posting}
          className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition enabled:hover:bg-violet-500 disabled:opacity-40"
        >
          Post
        </button>
      </div>

      {reporting && (
        <ReportSheet target={{ commentId: reporting }} onClose={() => setReporting(null)} />
      )}
    </div>
  );
}

export function CommentsSheet({
  cardId,
  cardTitle,
  onClose,
  onCountChange,
}: {
  cardId: string;
  cardTitle: string;
  onClose: () => void;
  onCountChange?: (n: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex h-[70dvh] flex-col rounded-t-3xl border-t border-neutral-800 bg-neutral-950 p-5 pb-8">
        <h2 className="mb-3 line-clamp-1 shrink-0 text-base font-bold">💬 {cardTitle}</h2>
        <CommentsPanel cardId={cardId} onCountChange={onCountChange} />
      </div>
    </div>
  );
}
