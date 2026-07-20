"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BillingButton } from "@/components/BillingButton";

const cardClass = "rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-left";

export function UpgradeClient({
  premium,
  activating,
}: {
  premium: boolean;
  /** true when we just got redirected back from a successful Checkout —
   * the webhook may not have landed yet even though the browser already has. */
  activating: boolean;
}) {
  const router = useRouter();
  const tries = useRef(0);

  useEffect(() => {
    if (!activating || premium) return;
    const id = setInterval(() => {
      tries.current += 1;
      if (tries.current > 6) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, 1500);
    return () => clearInterval(id);
  }, [activating, premium, router]);

  if (premium) {
    return (
      <div className={cardClass}>
        <div className="text-lg font-semibold text-violet-300">✨ You&apos;re Premium</div>
        <p className="mt-1 text-sm text-neutral-400">
          Ads are off and Deeper / Extra-deep reading is unlocked on every card.
        </p>
      </div>
    );
  }

  if (activating) {
    return (
      <div className={cardClass}>
        <div className="text-lg font-semibold">Activating your subscription…</div>
        <p className="mt-1 text-sm text-neutral-400">
          Payment received — this usually takes just a few seconds. Refresh if it doesn&apos;t
          update shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className={cardClass}>
        <div className="text-sm font-semibold text-neutral-200">Monthly</div>
        <div className="mt-1 text-2xl font-bold">$2.99<span className="text-sm font-normal text-neutral-500">/mo</span></div>
        <BillingButton
          kind="checkout"
          plan="monthly"
          label="Subscribe monthly"
          className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
        />
      </div>
      <div className={cardClass}>
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
          Annual <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">SAVE ~17%</span>
        </div>
        <div className="mt-1 text-2xl font-bold">$29.99<span className="text-sm font-normal text-neutral-500">/yr</span></div>
        <BillingButton
          kind="checkout"
          plan="annual"
          label="Subscribe yearly"
          className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
        />
      </div>
    </div>
  );
}
