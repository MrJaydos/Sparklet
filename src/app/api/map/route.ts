import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getKnowledgeMap } from "@/lib/knowledge-map";
import { forceLayout } from "@/lib/force-layout";

// Ports src/app/map/page.tsx's server-side work — that page had no API
// route, just a direct call to getKnowledgeMap()/forceLayout() inside the
// page component. The initial settled layout is computed here (same as the
// web) rather than shipped as a live client simulation, since it's O(n^2)
// per iteration; a client only needs to run the *live* wake-on-touch
// physics on top of these starting positions (see MapView.tsx's `step()`).
const LAYOUT_SIZE = 600;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const map = await getKnowledgeMap(userId);
  const positions = [...forceLayout(
    map.nodes.map((n) => n.id),
    map.edges,
    { width: LAYOUT_SIZE, height: LAYOUT_SIZE, iterations: 220 }
  ).entries()].map(([id, p]) => ({ id, x: p.x, y: p.y }));

  return NextResponse.json({
    nodes: map.nodes,
    edges: map.edges,
    totalLearned: map.totalLearned,
    positions,
  });
}
