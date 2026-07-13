"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/time";

type SearchResult = {
  id: string;
  title: string;
  createdAt: string;
  category: { name: string; icon: string; colorHex: string };
};

export function SearchSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const onChange = (value: string) => {
    setQ(value);
    if (value.trim()) {
      setSearching(true);
    } else {
      setResults([]);
      setSearching(false);
    }
  };

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: ctl.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setResults(data.results);
        }
        setSearching(false);
      } catch {
        /* aborted by a newer keystroke, or offline */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex max-h-[85dvh] min-h-[60dvh] flex-col rounded-t-3xl border-t border-neutral-800 bg-neutral-950 p-6 pb-8">
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search cards — quantum, Rome, sleep…"
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
        />
        <div className="mt-4 flex-1 overflow-y-auto">
          {q.trim() === "" ? (
            <p className="text-sm text-neutral-500">
              Jump straight to a topic instead of swiping for it.
            </p>
          ) : searching && results.length === 0 ? (
            <p className="text-sm text-neutral-500">Searching…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-neutral-500">No cards match &ldquo;{q.trim()}&rdquo;.</p>
          ) : (
            <ul className="space-y-1.5">
              {results.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/card/${r.id}`}
                    className="flex items-baseline justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition hover:border-neutral-700 hover:bg-neutral-900"
                  >
                    <span className="min-w-0">
                      <span className="text-xs" style={{ color: r.category.colorHex }}>
                        {r.category.icon}
                      </span>{" "}
                      <span className="text-sm text-neutral-200">{r.title}</span>
                    </span>
                    <span className="shrink-0 text-xs text-neutral-600">
                      {timeAgo(r.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
