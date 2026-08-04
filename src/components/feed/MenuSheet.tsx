"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { shareOrCopy } from "@/lib/share";
import type { PopoverAnchor } from "./usePopoverAnchor";

export function MenuSheet({
  unread,
  inviteUrl,
  isAdmin,
  isGuest,
  premium,
  billingEnabled,
  onSearch,
  onSuggest,
  onClose,
  signOutAction,
  anchor,
}: {
  unread: number;
  inviteUrl: string;
  isAdmin?: boolean;
  isGuest?: boolean;
  /** Hides the Upgrade CTA when already subscribed. Irrelevant for guests. */
  premium?: boolean;
  /** False pre-launch (before Stripe is configured) — hides the CTA entirely. */
  billingEnabled?: boolean;
  onSearch?: () => void;
  onSuggest?: () => void;
  onClose: () => void;
  signOutAction: () => Promise<void>;
  /** Desktop's "More" button position — a compact anchored dropdown instead
   * of the full-width mobile sheet. Omitted (the mobile hamburger) → full sheet. */
  anchor?: PopoverAnchor | null;
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
    <div
      className={anchor ? "fixed inset-0 z-50" : "fixed inset-0 z-50 flex flex-col justify-start"}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Anchored dropdown from the desktop "More" button, or a full-width
          sheet dropping from the header when opened via the mobile hamburger.
          The dropdown sizes itself to whatever room is left below the
          trigger (maxHeight) and only scrolls if the item list (which grows
          with isAdmin/onSuggest/billing state) doesn't fit — not capped to
          some fixed height regardless of how much space is actually there. */}
      <div
        style={anchor ? { ...anchor, maxHeight: `calc(100vh - ${anchor.top}px - 1rem)` } : undefined}
        className={
          anchor
            ? "sheet-drop absolute w-72 overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-4 shadow-2xl"
            : "sheet-drop relative rounded-b-3xl border-b border-neutral-800 bg-neutral-950 p-4 pt-[calc(env(safe-area-inset-top)+1.5rem)]"
        }
      >
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
            {onSuggest && (
              <button type="button" onClick={onSuggest} className={item()}>
                💡 Suggest a card
              </button>
            )}
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
            {billingEnabled && !premium && (
              <Link
                href="/upgrade"
                className="mt-2 flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
              >
                ✨ Go Premium
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
