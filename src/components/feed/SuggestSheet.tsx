"use client";

import { useEffect, useState } from "react";
import type { CategoryOption } from "./CategorySheet";

type Suggestion = {
  id: string;
  topic: string;
  status: "PENDING" | "INCLUDED" | "DISMISSED";
  createdAt: string;
  category: { name: string; icon: string };
};

const STATUS_LABEL: Record<Suggestion["status"], string> = {
  PENDING: "Waiting for the next batch",
  INCLUDED: "In this batch — cards land within a day",
  DISMISSED: "Not a fit",
};

export function SuggestSheet({
  categories,
  onClose,
}: {
  categories: CategoryOption[];
  onClose: () => void;
}) {
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    fetch("/api/suggestions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { suggestions?: Suggestion[] } | null) => setMine(data?.suggestions ?? []))
      .catch(() => setMine([]));
  }, []);

  const submit = async () => {
    if (!categorySlug || topic.trim().length < 6 || state !== "idle") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), categorySlug }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't submit that — try again.");
        setState("idle");
        return;
      }
      setState("done");
      setTimeout(onClose, 1600);
    } catch {
      setError("Couldn't submit that — try again.");
      setState("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-neutral-800 bg-neutral-950 p-6 pb-10">
        {state === "done" ? (
          <p className="py-6 text-center text-neutral-300">
            💡 Thanks — it&apos;ll be woven into the next batch for that topic.
          </p>
        ) : (
          <>
            <h2 className="text-lg font-bold">Suggest a card</h2>
            <p className="mt-1 text-sm text-neutral-400">
              What should we cover? Pick a topic and a category — it feeds into the next
              auto-generated batch for that category (still fact-checked and source-verified
              like every other card, so not every request makes it in).
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {categories.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setCategorySlug(c.slug)}
                  className={`truncate rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                    categorySlug === c.slug
                      ? "border-violet-500 bg-violet-500/15 text-violet-300"
                      : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
                  }`}
                >
                  {c.icon} {c.name}
                </button>
              ))}
            </div>

            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              placeholder="e.g. how the Wright brothers actually tested their first flights"
              className="mt-3 w-full resize-none rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none focus:border-neutral-600"
              rows={3}
            />
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

            <button
              type="button"
              disabled={!categorySlug || topic.trim().length < 6 || state === "sending"}
              onClick={submit}
              className="mt-3 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white transition enabled:hover:bg-violet-500 disabled:opacity-40"
            >
              {state === "sending" ? "Sending…" : "Submit suggestion"}
            </button>

            {mine && mine.length > 0 && (
              <div className="mt-6 border-t border-neutral-800 pt-4">
                <h3 className="text-sm font-semibold text-neutral-300">Your suggestions</h3>
                <ul className="mt-2 space-y-2">
                  {mine.map((s) => (
                    <li key={s.id} className="text-sm text-neutral-400">
                      <span className="text-neutral-200">
                        {s.category.icon} {s.topic}
                      </span>
                      <span className="ml-2 text-xs text-neutral-500">{STATUS_LABEL[s.status]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
