"use client";

import Link from "next/link";
import { useState } from "react";

export type HistoryRow = {
  cardId: string;
  title: string;
  icon: string;
  colorHex: string;
  when: string;
};

const COLLAPSED_COUNT = 5;

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <>
      <ul className="mt-3 space-y-1.5">
        {visible.map((r) => (
          <li key={r.cardId}>
            <Link
              href={`/card/${r.cardId}`}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition hover:border-neutral-700 hover:bg-neutral-900"
            >
              <span className="min-w-0">
                <span className="text-xs" style={{ color: r.colorHex }}>
                  {r.icon}
                </span>{" "}
                <span className="text-sm text-neutral-200">{r.title}</span>
              </span>
              <span className="shrink-0 text-xs text-neutral-600">{r.when}</span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-sm text-neutral-400 underline hover:text-neutral-200"
        >
          {expanded ? "Show less" : `See ${rows.length - COLLAPSED_COUNT} more`}
        </button>
      )}
    </>
  );
}
