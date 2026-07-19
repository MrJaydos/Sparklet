import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Accept a pending request. Only the addressee may accept.
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const friendship = await prisma.friendship.findUnique({ where: { id } });
  if (!friendship || friendship.addresseeId !== userId || friendship.status !== "PENDING") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.friendship.update({
    where: { id },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

// Decline a pending request, cancel one you sent, or unfriend an accepted
// one — same effect (remove the row) from either side.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const friendship = await prisma.friendship.findUnique({ where: { id } });
  if (!friendship || (friendship.requesterId !== userId && friendship.addresseeId !== userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.friendship.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
