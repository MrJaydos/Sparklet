import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALLOWED_MOBILE_SCHEMES, MOBILE_CODE_TTL_MS, mobileCodeIdentifier } from "@/lib/mobile-auth";

// Final stop of the web login flow when it was started with
// /login?mobileScheme=<scheme> (see src/lib/mobile-auth.ts): the browser
// lands here still carrying the session cookie Auth.js just set, so mint a
// short-lived one-time code and hand the browser off to the native app via
// its deep link. The code, not the session itself, is what crosses that
// boundary — see mobile-auth.ts for why.
export async function GET(req: NextRequest) {
  const scheme = req.nextUrl.searchParams.get("scheme");
  if (!scheme || !ALLOWED_MOBILE_SCHEMES.has(scheme)) {
    return NextResponse.json({ error: "invalid scheme" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL(`/login?mobileScheme=${scheme}`, req.url));
  }

  const code = crypto.randomBytes(24).toString("base64url");
  await prisma.verificationToken.create({
    data: {
      identifier: mobileCodeIdentifier(session.user.id),
      token: code,
      expires: new Date(Date.now() + MOBILE_CODE_TTL_MS),
    },
  });

  return NextResponse.redirect(`${scheme}://auth?code=${code}`);
}
