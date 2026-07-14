import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { audioEnabled, getCardAudio } from "@/lib/audio";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!audioEnabled()) {
    return NextResponse.json({ error: "narration unavailable" }, { status: 503 });
  }
  const { id } = await params;

  const card = await prisma.card.findUnique({
    where: { id },
    select: { id: true, title: true, body: true },
  });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  try {
    const wav = await getCardAudio(card.id, `${card.title}. ${card.body}`);
    return new NextResponse(new Uint8Array(wav), {
      headers: {
        "content-type": "audio/wav",
        // Immutable content: cache hard on the client, keep it private.
        "cache-control": "private, max-age=604800, immutable",
      },
    });
  } catch (e) {
    console.warn("narration failed:", e);
    return NextResponse.json({ error: "narration failed" }, { status: 502 });
  }
}
