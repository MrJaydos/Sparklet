"use client";

import { useState } from "react";

type Props =
  | { kind: "checkout"; plan: "monthly" | "annual"; label: string; className: string }
  | { kind: "portal"; label: string; className: string };

/** Posts to the checkout/portal route and redirects to the returned Stripe URL. */
export function BillingButton(props: Props) {
  const [loading, setLoading] = useState(false);

  const go = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        props.kind === "checkout" ? "/api/billing/checkout" : "/api/billing/portal",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: props.kind === "checkout" ? JSON.stringify({ plan: props.plan }) : undefined,
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={go} disabled={loading} className={props.className}>
      {loading ? "…" : props.label}
    </button>
  );
}
