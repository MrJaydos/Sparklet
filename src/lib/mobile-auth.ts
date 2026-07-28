// Native mobile clients (sparklet-ios, sparklet-android) can't hold the
// Auth.js session cookie, so they complete the normal web login flow in a
// system-browser context (ASWebAuthenticationSession / Custom Tabs — an
// embedded WebView would trip Google's disallowed_useragent block), then
// exchange a short-lived one-time code for a Bearer token via
// /api/auth/mobile-exchange. The code — never the long-lived session token
// itself — is what travels through the deep-link redirect, since URLs end up
// in browser history and OS logs (RFC 8252's whole reason for preferring an
// auth-code handoff over handing back a token directly).
//
// The redirect scheme is allowlisted, not passed through freely: an
// attacker-chosen scheme could be a different app registered under that same
// name, and possession of the code alone is enough to mint a real session at
// /mobile-exchange, so an unvalidated scheme would hand that code to
// whichever app the OS resolves it to.
export const ALLOWED_MOBILE_SCHEMES = new Set(["sparklet-ios", "sparklet-android"]);

export const MOBILE_CODE_TTL_MS = 60_000;

// Namespaces the one-time code in the shared VerificationToken table so it
// can never collide with (or be confused for) a real email-verification
// token, whose identifier is always an email address.
export const MOBILE_CODE_PREFIX = "mobile-code:";

export function mobileCodeIdentifier(userId: string): string {
  return `${MOBILE_CODE_PREFIX}${userId}`;
}

export const MOBILE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
