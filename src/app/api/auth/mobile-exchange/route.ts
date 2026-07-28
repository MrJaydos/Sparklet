import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { MOBILE_CODE_PREFIX, MOBILE_SESSION_MAX_AGE_MS } from "@/lib/mobile-auth";

const bodySchema = z.object({ code: z.string().min(1) });

// Exchanges the one-time code from /api/auth/mobile-complete's deep-link
// redirect for a long-lived Bearer token. Called by the native app itself
// over a direct HTTPS request — never via the browser/deep-link — so the
// real credential never travels through a URL.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // delete() atomically claims the row: a concurrent or replayed exchange of
  // the same code finds nothing on its own delete and fails, rather than
  // both requests reading the row before either removes it.
  let record;
  try {
    record = await prisma.verificationToken.delete({ where: { token: parsed.data.code } });
  } catch {
    record = null;
  }

  if (!record || !record.identifier.startsWith(MOBILE_CODE_PREFIX) || record.expires < new Date()) {
    return NextResponse.json({ error: "invalid or expired code" }, { status: 401 });
  }

  const userId = record.identifier.slice(MOBILE_CODE_PREFIX.length);
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + MOBILE_SESSION_MAX_AGE_MS);
  await prisma.session.create({ data: { sessionToken, userId, expires } });

  return NextResponse.json({ token: sessionToken, expires: expires.toISOString() });
}
