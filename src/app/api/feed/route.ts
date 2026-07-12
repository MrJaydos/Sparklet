import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFeedCards } from "@/lib/feed";

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const categorySlugs = params.get("categories")?.split(",").filter(Boolean) ?? [];
  const take = Math.min(Number(params.get("take")) || 10, 30);
  const allowRepeats = params.get("allowRepeats") === "1";
  const excludeIds = params.get("exclude")?.split(",").filter(Boolean) ?? [];

  const result = await getFeedCards({ userId, categorySlugs, take, allowRepeats, excludeIds });
  return NextResponse.json(result);
}
