import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isAdminEmail, rejectCard } from "@/lib/admin";
import { prisma } from "@/lib/db";

const bodySchema = z.object({ action: z.union([z.literal("publish"), z.literal("delete")]) });

/** Same publish/delete actions as the admin page's "Cards awaiting review"
 * list — a plain fetch endpoint so the moderation swiper can act on a swipe
 * without a full page navigation/revalidate. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { cardId } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  if (parsed.data.action === "publish") {
    await prisma.card.update({
      where: { id: cardId },
      data: { published: true, reviewNote: null },
    });
  } else {
    await rejectCard(cardId);
  }

  return NextResponse.json({ ok: true });
}
