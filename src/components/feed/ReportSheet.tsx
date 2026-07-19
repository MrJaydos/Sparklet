"use client";

import { useState } from "react";

const REASONS = [
  { value: "INCORRECT", label: "❌ Factually incorrect" },
  { value: "INAPPROPRIATE", label: "⚠️ Inappropriate" },
  { value: "SPAM", label: "🗑️ Spam" },
  { value: "OTHER", label: "💬 Something else" },
] as const;

export function ReportSheet({
  target,
  onClose,
}: {
  target: { cardId: string } | { commentId: string };
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  const submit = async () => {
    if (!reason || state !== "idle") return;
    setState("sending");
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...target, reason, detail: detail || undefined }),
      });
      setState("done");
      setTimeout(onClose, 1200);
    } catch {
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
      <div className="relative rounded-t-3xl border-t border-neutral-800 bg-neutral-950 p-6 pb-10">
        {state === "done" ? (
          <p className="py-6 text-center text-neutral-300">
            ✅ Thanks — we&apos;ll take a look.
          </p>
        ) : (
          <>
            <h2 className="text-lg font-bold">
              Report {"cardId" in target ? "this card" : "this comment"}
            </h2>
            <div className="mt-4 grid gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                    reason === r.value
                      ? "border-red-500 bg-red-500/15 text-red-300"
                      : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <textarea
              value={detail}
              onChange={(e) => {
                setDetail(e.target.value);
                if (!reason) setReason("OTHER");
              }}
              maxLength={500}
              placeholder="Anything else we should know? (optional)"
              className="mt-3 w-full resize-none rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none focus:border-neutral-600"
              rows={2}
            />
            <button
              type="button"
              disabled={!reason || state === "sending"}
              onClick={submit}
              className="mt-3 w-full rounded-xl bg-red-600 px-4 py-3 font-semibold text-white transition enabled:hover:bg-red-500 disabled:opacity-40"
            >
              {state === "sending" ? "Sending…" : "Send report"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
