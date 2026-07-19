"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { shareOrCopy } from "@/lib/share";

export function MenuSheet({
  unread,
  inviteUrl,
  isAdmin,
  isGuest,
  onSearch,
  onClose,
  signOutAction,
}: {
  unread: number;
  inviteUrl: string;
  isAdmin?: boolean;
  isGuest?: boolean;
  onSearch?: () => void;
  onClose: () => void;
  signOutAction: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const pathname = usePathname();
  const item = (active = false) =>
    `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
      active
        ? "bg-violet-600/15 text-violet-300"
        : "text-neutral-200 hover:bg-neutral-900"
    }`;

  const invite = () =>
    shareOrCopy(
      {
        title: "Sparklet",
        text: "Learn something real, one swipe at a time — join me on Sparklet:",
        url: inviteUrl,
      },
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-start" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drops down from the header that opened it */}
      <div className="sheet-drop relative rounded-b-3xl border-b border-neutral-800 bg-neutral-950 p-4 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <Link href="/feed" className={item(pathname === "/feed")}>
          🏠 Home
        </Link>
        {onSearch && (
          <button type="button" onClick={onSearch} className={item()}>
            🔍 Search cards
          </button>
        )}
        {isGuest ? (
          <>
            <p className="mt-4 px-4 text-sm text-neutral-500">
              Sign in to save streaks, saves, comments, and XP as you go.
            </p>
            <Link
              href="/login?callbackUrl=%2Ffeed"
              className="mt-2 flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            <Link href="/notifications" className={item(pathname === "/notifications")}>
              🔔 Notifications
              {unread > 0 && (
                <span className="ml-auto rounded-full bg-violet-600 px-2 py-0.5 text-xs font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <Link href="/leaderboard" className={item(pathname === "/leaderboard")}>
              🏆 Leaderboard
            </Link>
            <Link href="/profile" className={item(pathname === "/profile")}>
              👤 Profile
            </Link>
            {isAdmin && (
              <Link href="/admin" className={item(pathname === "/admin")}>
                🛠️ Admin
              </Link>
            )}
            <button type="button" onClick={invite} className={item()}>
              🎁 Invite a friend
              <span className="ml-auto text-xs text-neutral-500">
                {copied ? "Copied!" : "+1 freeze"}
              </span>
            </button>
            <form action={signOutAction} className="mt-2 border-t border-neutral-800 pt-2">
              <button type="submit" className={item()}>
                🚪 Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
