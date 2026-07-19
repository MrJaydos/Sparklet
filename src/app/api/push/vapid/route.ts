import { NextResponse } from "next/server";
import { VAPID_PUBLIC_KEY, pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Public VAPID key for pushManager.subscribe(); the client hides all
 *  reminder UI when push isn't configured on the server. */
export async function GET() {
  if (!pushConfigured) return NextResponse.json({ configured: false }, { status: 200 });
  return NextResponse.json({ configured: true, publicKey: VAPID_PUBLIC_KEY });
}
