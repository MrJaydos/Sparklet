"use client";

import Link from "next/link";

export function MenuSheet({
  unread,
  onSearch,
  onClose,
}: {
  unread: number;
  onSearch: () => void;
  onClose: () => void;
}) {
  const item =
    "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-neutral-200 transition hover:bg-neutral-900";
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-start" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drops down from the header that opened it */}
      <div className="sheet-drop relative rounded-b-3xl border-b border-neutral-800 bg-neutral-950 p-4 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
        <button type="button" onClick={onSearch} className={item}>
          🔍 Search cards
        </button>
        <Link href="/notifications" className={item}>
          🔔 Notifications
          {unread > 0 && (
            <span className="ml-auto rounded-full bg-violet-600 px-2 py-0.5 text-xs font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        <Link href="/leaderboard" className={item}>
          🏆 Leaderboard
        </Link>
        <Link href="/profile" className={item}>
          👤 Profile
        </Link>
      </div>
    </div>
  );
}
