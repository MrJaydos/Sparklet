"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { timeAgo } from "@/lib/time";
import { usePopoverAnchor } from "./usePopoverAnchor";

type Notification = {
  id: string;
  actorName: string;
  cardId: string;
  cardTitle: string;
  preview: string | null;
  createdAt: string;
  read: boolean;
};

/**
 * Header notification bell. Tapping it opens a popup listing recent
 * comment-reply notifications and marks them read.
 *
 * On mobile (< sm): full-screen slide-down sheet.
 * On desktop (≥ sm): compact pill dropdown anchored to the button.
 */
export function NotificationsBell({
  unread,
  onOpened,
}: {
  unread: number;
  /** Called once the popup's mark-all-read request succeeds. */
  onOpened: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const { triggerRef, anchor, measure } = usePopoverAnchor<HTMLButtonElement>();

  const handleOpen = () => {
    measure();
    setOpen(true);
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setNotifications(data.notifications);
      })
      .catch(() => setNotifications([]));
    if (unread > 0) {
      fetch("/api/notifications", { method: "POST" })
        .then((r) => {
          if (r.ok) onOpened();
        })
        .catch(() => {});
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        aria-label="Notifications"
        className="pointer-events-auto relative hidden whitespace-nowrap rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs font-semibold backdrop-blur transition hover:bg-neutral-800 sm:block"
      >
        🔔 Notifications
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-start"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
              onClick={() => setOpen(false)}
            />
            <div
              style={anchor ?? undefined}
              className="sheet-drop relative flex max-h-[85dvh] min-h-[40dvh] flex-col rounded-b-3xl border-b border-neutral-800 bg-neutral-950 p-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:absolute sm:max-h-[28rem] sm:min-h-0 sm:w-96 sm:rounded-2xl sm:border sm:p-4 sm:pt-4 sm:shadow-2xl"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-bold">🔔 Notifications</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-full px-2 py-1 text-sm text-neutral-500 transition hover:text-neutral-200"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex-1 overflow-y-auto">
                {notifications === null ? (
                  <p className="text-sm text-neutral-500">Loading…</p>
                ) : notifications.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    When someone replies in a comment thread you&apos;re part of, it
                    shows up here.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {notifications.map((n) => (
                      <li key={n.id}>
                        <Link
                          href={`/card/${n.cardId}`}
                          onClick={() => setOpen(false)}
                          className={`block rounded-xl border p-3 text-sm transition hover:border-neutral-600 ${
                            n.read
                              ? "border-neutral-800 bg-neutral-900"
                              : "border-violet-800 bg-violet-950/30"
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span>
                              <span className="font-semibold">{n.actorName}</span>{" "}
                              <span className="text-neutral-400">commented on</span>{" "}
                              <span className="font-medium">{n.cardTitle}</span>
                            </span>
                            <span className="shrink-0 text-xs text-neutral-600">
                              {timeAgo(n.createdAt)}
                            </span>
                          </div>
                          {n.preview && (
                            <p className="mt-1 line-clamp-2 text-neutral-500">
                              &ldquo;{n.preview}&rdquo;
                            </p>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
