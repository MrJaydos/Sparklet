import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Mobile sign-out: deletes the Session row backing the caller's Bearer
// token. Reads the header directly rather than going through auth() since
// the point is to invalidate the token, not resolve who it belongs to.
export async function DELETE(req: NextRequest) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await prisma.session.deleteMany({ where: { sessionToken: token } });
  return NextResponse.json({ ok: true });
}
