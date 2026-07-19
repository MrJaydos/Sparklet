"use client";

import { useEffect, useState } from "react";
import { getPushState, subscribeToPush, unsubscribeFromPush, type PushState } from "@/lib/push-client";

/** Reminders on/off for this device, shown on the profile page. Hidden
 *  entirely when push isn't available (iOS Safari before home-screen
 *  install, or server keys unset). */
export function PushToggle() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  if (state === "loading" || state === "unsupported" || state === "unconfigured") return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    if (state === "subscribed") {
      await unsubscribeFromPush();
      setState("ready");
    } else {
      setState((await subscribeToPush()) ? "subscribed" : await getPushState());
    }
    setBusy(false);
  };

  return (
    <div className="mt-6 flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div>
        <div className="text-sm font-medium text-neutral-200">🔔 Reminders on this device</div>
        <div className="mt-0.5 text-xs text-neutral-500">
          {state === "denied"
            ? "Blocked in your browser settings — allow notifications for this site to enable."
            : "Due reviews, streak saves and the occasional great card. One a day, tops."}
        </div>
      </div>
      {state !== "denied" && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={state === "subscribed"}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
            state === "subscribed"
              ? "bg-violet-600 text-white hover:bg-violet-500"
              : "border border-neutral-700 text-neutral-300 hover:border-neutral-500"
          }`}
        >
          {busy ? "…" : state === "subscribed" ? "On" : "Off"}
        </button>
      )}
    </div>
  );
}
