"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// Swaps its children for a spinner while the parent <form>'s action is
// pending — Server Actions like signIn() have no client-side loading state
// of their own, so without this a slow one (e.g. Apple's redirect round
// trip) just looks like the tap did nothing.
export function SubmitButton({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : (
        children
      )}
    </button>
  );
}
