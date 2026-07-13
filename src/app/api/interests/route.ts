import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const bodySchema = z.object({ categoryIds: z.array(z.string()).max(8) });

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await prisma.$transaction([
    prisma.userInterest.deleteMany({ where: { userId } }),
    ...(parsed.data.categoryIds.length
      ? [
          prisma.userInterest.createMany({
            data: parsed.data.categoryIds.map((categoryId) => ({ userId, categoryId })),
            skipDuplicates: true,
          }),
        ]
      : []),
    // Submitting (even an empty skip) completes onboarding.
    prisma.user.update({ where: { id: userId }, data: { onboardedAt: new Date() } }),
  ]);
  return NextResponse.json({ ok: true });
}
