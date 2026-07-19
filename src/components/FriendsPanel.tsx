"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type FriendRow = { friendshipId: string; name: string; email: string };

export function FriendsPanel({
  friends,
  incoming,
  outgoing,
  friendCode,
}: {
  friends: FriendRow[];
  incoming: FriendRow[];
  outgoing: FriendRow[];
  friendCode: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(friendCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  const sendRequest = async () => {
    const value = email.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      // A friend code (e.g. "K7M4QRT") has no @ — fall back to it when the
      // input isn't a plausible email, so the same field handles both.
      const isEmail = /\S+@\S+\.\S+/.test(value);
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isEmail ? { email: value } : { code: value }),
      });
      const data = await res.json().catch(() => null);
      setNotice(res.ok ? data?.message ?? "Request sent." : data?.error ?? "Couldn't send that request.");
      setEmail("");
      router.refresh();
    } finally {
      setSending(false);
    }
  };

  const accept = async (friendshipId: string) => {
    setBusyId(friendshipId);
    await fetch(`/api/friends/${friendshipId}`, { method: "PATCH" }).catch(() => {});
    setBusyId(null);
    router.refresh();
  };

  const remove = async (friendshipId: string) => {
    setBusyId(friendshipId);
    await fetch(`/api/friends/${friendshipId}`, { method: "DELETE" }).catch(() => {});
    setBusyId(null);
    router.refresh();
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5">
        <span className="min-w-0 truncate text-sm text-neutral-400">
          Your code: <span className="font-mono font-semibold tracking-wider text-neutral-100">{friendCode}</span>
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-white"
        >
          {codeCopied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Add a friend by email or code"
          className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={sendRequest}
          disabled={sending || !email.trim()}
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-white disabled:opacity-40"
        >
          {sending ? "…" : "Add"}
        </button>
      </div>
      {notice && <p className="mt-2 text-xs text-neutral-500">{notice}</p>}

      {incoming.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {incoming.map((r) => (
            <li
              key={r.friendshipId}
              className="flex items-center justify-between gap-3 rounded-xl border border-violet-600/60 bg-violet-600/10 px-4 py-2.5"
            >
              <span className="min-w-0 truncate text-sm text-neutral-100">{r.name} wants to be friends</span>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => accept(r.friendshipId)}
                  disabled={busyId === r.friendshipId}
                  className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.friendshipId)}
                  disabled={busyId === r.friendshipId}
                  className="rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-400 transition hover:border-neutral-500 disabled:opacity-50"
                >
                  Decline
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {outgoing.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {outgoing.map((r) => (
            <li
              key={r.friendshipId}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5"
            >
              <span className="min-w-0 truncate text-sm text-neutral-400">Request sent to {r.name}</span>
              <button
                type="button"
                onClick={() => remove(r.friendshipId)}
                disabled={busyId === r.friendshipId}
                className="shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-400 transition hover:border-neutral-500 disabled:opacity-50"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      {friends.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          No friends yet — add one by email or code to compare progress on the leaderboard.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {friends.map((r) => (
            <li
              key={r.friendshipId}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5"
            >
              <span className="min-w-0 truncate text-sm text-neutral-200">{r.name}</span>
              <button
                type="button"
                onClick={() => remove(r.friendshipId)}
                disabled={busyId === r.friendshipId}
                className="shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-400 transition hover:border-neutral-500 disabled:opacity-50"
              >
                Unfriend
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
