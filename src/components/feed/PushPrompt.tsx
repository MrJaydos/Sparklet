"use client";

import { useState } from "react";
import { subscribeToPush } from "@/lib/push-client";

/**
 * Soft-ask for push reminders, shown from the feed only after the user has
 * swiped a few cards (never on first paint). The browser's permission
 * dialog appears only after they tap "Turn on reminders", so a dismissal
 * here costs nothing — we can offer again later, whereas a denied browser
 * prompt is near-permanent.
 */
export function PushPrompt({ onDone }: { onDone: (enabled: boolean) => void }) {
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await subscribeToPush();
    onDone(ok);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="sheet-drop w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden>
            🔔
          </span>
          <div className="min-w-0">
            <h3 className="font-bold text-neutral-100">Want the occasional nudge?</h3>
            <p className="mt-1 text-sm text-neutral-400">
              A heads-up when reviews are due, your streak&apos;s about to break, or a card worth
              seeing drops. One a day at most.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
          >
            {busy ? "…" : "Turn on reminders"}
          </button>
          <button
            type="button"
            onClick={() => onDone(false)}
            className="rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-300 transition hover:border-neutral-500"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
