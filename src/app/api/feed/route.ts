import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFeedCards } from "@/lib/feed";

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const params = req.nextUrl.searchParams;
  const categorySlugs = params.get("categories")?.split(",").filter(Boolean) ?? [];
  const take = Math.min(Number(params.get("take")) || 10, 30);
  const allowRepeats = params.get("allowRepeats") === "1";
  // Capped: this goes straight into a NOT IN, and the caller controls how
  // long it is. The client only ever sends the cards on screen this session,
  // so the ceiling is far above real usage and only bites a crafted request.
  const excludeIds = (params.get("exclude")?.split(",").filter(Boolean) ?? []).slice(0, 500);

  const result = await getFeedCards({ userId, categorySlugs, take, allowRepeats, excludeIds });
  return NextResponse.json(result);
}
