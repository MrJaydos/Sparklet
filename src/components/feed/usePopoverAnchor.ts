"use client";

import { useRef, useState, type RefObject } from "react";

export type PopoverAnchor = { top: number; right: number };

/**
 * Captures a trigger button's on-screen position so a portaled popover can
 * drop down anchored to that button instead of a fixed viewport corner.
 * Call `measure()` in the button's onClick (before the portal mounts) —
 * getBoundingClientRect needs the button already laid out.
 */
export function usePopoverAnchor<T extends HTMLElement = HTMLButtonElement>() {
  const triggerRef = useRef<T>(null) as RefObject<T | null>;
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);

  const measure = () => {
    // Below Tailwind's `sm` breakpoint the popover is a full-width sheet in
    // normal flow, not an anchored dropdown — leave anchor null so the
    // panel's `relative` positioning (which, unlike `static`, honors
    // top/right offsets) doesn't shift it off-screen.
    if (window.matchMedia("(max-width: 639px)").matches) {
      setAnchor(null);
      return null;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const next = { top: rect.bottom + 8, right: window.innerWidth - rect.right };
    setAnchor(next);
    return next;
  };

  const clear = () => setAnchor(null);

  return { triggerRef, anchor, measure, clear };
}
