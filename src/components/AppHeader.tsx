"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { StreakBadge } from "./feed/StreakBadge";
import { XpRing } from "./feed/XpRing";
import { NotificationsBell } from "./feed/NotificationsBell";
import { MenuSheet } from "./feed/MenuSheet";

/**
 * The same floating header/hamburger-menu chrome as the feed, minus the
 * feed-only controls (topic picker, search) — used by every other
 * authenticated page so navigation feels consistent across the app.
 */
export function AppHeader({
  streak,
  longestStreak,
  freezesAvailable,
  xpToday,
  dailyGoal,
  unread: initialUnread,
  inviteUrl,
  isAdmin,
  signOutAction,
}: {
  streak: number;
  longestStreak: number;
  freezesAvailable: number;
  xpToday: number;
  dailyGoal: number;
  unread: number;
  inviteUrl: string;
  isAdmin: boolean;
  signOutAction: () => Promise<void>;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const [showMenu, setShowMenu] = useState(false);
  const pathname = usePathname();

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`hidden whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur transition min-[1000px]:block ${
        pathname === href
          ? "bg-violet-600/20 text-violet-300"
          : "bg-neutral-900/80 hover:bg-neutral-800"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-2 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.625rem)]">
        <Link
          href="/feed"
          className="pointer-events-auto shrink-0 whitespace-nowrap text-base font-bold drop-shadow sm:text-lg"
        >
          ✨ Sparklet
        </Link>
        <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
          {navLink("/feed", "🏠 Home")}
          {navLink("/leaderboard", "🏆 Leaderboard")}
          {navLink("/profile", "👤 Profile")}
          {isAdmin && navLink("/admin", "🛠️ Admin")}
          <StreakBadge
            streak={streak}
            longestStreak={longestStreak}
            freezesAvailable={freezesAvailable}
          />
          <XpRing today={xpToday} goal={dailyGoal} />
          <NotificationsBell unread={unread} onOpened={setUnread} />
          <button
            type="button"
            onClick={() => setShowMenu(true)}
            aria-label="Menu"
            className="relative rounded-full bg-neutral-900/80 px-2.5 py-1.5 text-xs backdrop-blur transition hover:bg-neutral-800 min-[1000px]:hidden"
          >
            ☰
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </div>
      </header>

      {showMenu && (
        <MenuSheet
          unread={unread}
          inviteUrl={inviteUrl}
          isAdmin={isAdmin}
          onClose={() => setShowMenu(false)}
          signOutAction={signOutAction}
        />
      )}
    </>
  );
}
