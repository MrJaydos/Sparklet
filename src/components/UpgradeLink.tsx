"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/lib/analytics";

/** A link to /upgrade that records an `upgrade-click` event tagged with where
 * it was clicked from.
 *
 * Tracked in onClick rather than with Umami's data-umami-event attribute: on
 * an <a>, Umami's click handler cancels the click and sets location.href
 * itself, turning a client-side navigation into a full page reload. */
export function UpgradeLink({
  source,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { source: string }) {
  return (
    <Link
      href="/upgrade"
      onClick={(e) => {
        track("upgrade-click", { source });
        onClick?.(e);
      }}
      {...props}
    />
  );
}
