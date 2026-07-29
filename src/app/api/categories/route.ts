import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Same query the onboarding page and the signed-out feed page already run
// server-side (src/app/onboarding/page.tsx, src/app/feed/page.tsx) — native
// clients need a JSON source for the same list to build the interest-picker
// grid. No auth required: the signed-out feed page uses this list too.
export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { slug: true, name: true, colorHex: true, icon: true },
  });
  return NextResponse.json({ categories });
}
