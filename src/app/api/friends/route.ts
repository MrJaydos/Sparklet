import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const bodySchema = z.object({ email: z.string().email() });

// Identical response whether or not the email belongs to an account, so this
// can't be used to enumerate registered users. A fresh NextResponse every
// call — its body is a ReadableStream that can only be consumed once, so a
// single shared instance would return empty bodies after the first request.
function sentResponse() {
  return NextResponse.json({ ok: true, message: "Request sent if they're on Sparklet." });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase().trim() },
    select: { id: true },
  });
  if (!target || target.id === userId) return sentResponse();

  const [outgoing, incoming] = await Promise.all([
    prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: userId, addresseeId: target.id } },
    }),
    prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: target.id, addresseeId: userId } },
    }),
  ]);

  if (outgoing || incoming?.status === "ACCEPTED") return sentResponse();

  if (incoming?.status === "PENDING") {
    // Mutual request — accept theirs instead of creating a second row.
    await prisma.friendship.update({
      where: { id: incoming.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
  } else {
    await prisma.friendship.create({
      data: { requesterId: userId, addresseeId: target.id },
    });
  }
  return sentResponse();
}
