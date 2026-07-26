import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { prisma } from "@/lib/db";

export const GET = handlers.GET;

// Safari intermittently drops the state/nonce cookies Auth.js sets before
// redirecting to Apple's authorize endpoint, so they never make it back on
// this POST callback (a known, unresolved Apple/WebKit quirk — Chrome
// doesn't hit it). When that happens, recover them from the server-side
// backup appleAction() stashed (src/app/login/page.tsx), keyed by the
// `state` form field Apple echoes back reliably regardless of cookies, by
// rebuilding the request with the restored cookies before handing it to
// Auth.js's normal handler.
export async function POST(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (cookieHeader.includes("authjs.state=")) {
    return handlers.POST(request);
  }

  const formData = await request.formData();
  const state = formData.get("state");
  const stateValue = typeof state === "string" ? state : null;
  let backup = null;
  if (stateValue) {
    backup = await prisma.oAuthStateBackup.findUnique({ where: { state: stateValue } });
    if (backup) await prisma.oAuthStateBackup.delete({ where: { state: stateValue } }).catch(() => {});
  }

  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  if (backup && backup.expiresAt > new Date()) {
    const restored = (backup.cookies as { name: string; value: string }[])
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    headers.set("cookie", cookieHeader ? `${cookieHeader}; ${restored}` : restored);
  }

  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params.set(key, value);
  }
  return handlers.POST(new NextRequest(request.url, { method: "POST", headers, body: params }));
}
