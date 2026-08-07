import crypto from "node:crypto";

/**
 * Shared-secret check for the cron-facing endpoints (`/api/admin/nudge`,
 * `/api/admin/revalidate`, `/api/admin/suggestions`, `/api/inventory`),
 * called with `Authorization: Bearer $REVALIDATE_TOKEN` by the GitHub
 * Actions workflows and by scripts/generate-content.ts.
 *
 * Compared with timingSafeEqual rather than `!==`: a plain string compare
 * bails at the first differing byte, so how long it takes leaks how much of
 * the prefix was right, and these endpoints are unauthenticated apart from
 * this token. Lengths are hashed to a fixed 32 bytes first because
 * timingSafeEqual throws on a length mismatch (which would itself leak the
 * secret's length).
 */
export function isValidCronToken(req: Request): boolean {
  const expected = process.env.REVALIDATE_TOKEN;
  if (!expected) return false;

  const provided = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!provided) return false;

  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
