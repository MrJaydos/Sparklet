/** Umami custom events. A silent no-op whenever the tracker isn't loaded
 * (dev, website ID unset, blocked by an ad blocker), so callers never need
 * to guard. Client-only — call from event handlers / effects.
 *
 * These are product analytics, not a source of truth: nothing here is
 * server-verified, and XP/streak logic must never read from it. */

type EventData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: { track: (event: string, data?: EventData) => void };
  }
}

export type AnalyticsEvent = "card-read" | "quiz-answer" | "upgrade-click" | "checkout-click";

export function track(event: AnalyticsEvent, data?: EventData) {
  try {
    window.umami?.track(event, data);
  } catch {
    /* analytics must never break the app */
  }
}
