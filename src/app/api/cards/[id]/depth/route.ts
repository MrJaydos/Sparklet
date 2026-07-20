import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { generateJSON } from "@/lib/ai-provider";
import { contentHash } from "@/lib/content-schema";
import { isBillingEnabled } from "@/lib/billing";

/**
 * Depth variants of a card (SIMPLE | DEEP). Returns a pre-generated variant
 * when one exists in the card's depth group; otherwise lazily generates one
 * and caches it as a real Card row. This is the one place the web app calls
 * an AI provider directly — gated on server-side keys, and standard cards
 * never depend on it.
 */

const bodySchema = z.object({ level: z.enum(["SIMPLE", "DEEP", "EXTRA_DEEP"]) });

const variantSchema = z.object({
  title: z.string().min(5).max(120),
  body: z.string().min(30).max(4000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const level = parsed.data.level;

  // SIMPLE stays free for everyone; DEEP/EXTRA_DEEP are the premium perk —
  // but only once billing is actually set up. Until then isPremium() is
  // false for everyone, so gating on that alone would lock this out for
  // every user the moment this code deploys, before there's a working
  // checkout to unlock it again. Gated here, before the pre-generated-variant
  // lookup below — that lookup has no check of its own, so it's the actual
  // bypass a free user would hit.
  if (
    (level === "DEEP" || level === "EXTRA_DEEP") &&
    isBillingEnabled() &&
    !session?.user?.premium
  ) {
    return NextResponse.json({ error: "premium required", level }, { status: 402 });
  }

  const card = await prisma.card.findUnique({
    where: { id },
    include: { category: { select: { id: true, name: true } } },
  });
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });

  // Cards imported before depth support have no group — self-heal using the
  // card's own id as the group id.
  if (!card.depthGroupId) {
    await prisma.card.update({ where: { id: card.id }, data: { depthGroupId: card.id } });
    card.depthGroupId = card.id;
  }

  const existing = await prisma.card.findFirst({
    where: { depthGroupId: card.depthGroupId, depthLevel: level },
  });
  if (existing) {
    return NextResponse.json({
      card: { id: existing.id, title: existing.title, body: existing.body, depthLevel: level },
      generated: false,
    });
  }

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "depth variants unavailable" }, { status: 503 });
  }

  const specs = {
    SIMPLE:
      "a SIMPLER version: 30-45 words, plainer vocabulary a 12-year-old follows easily, keep the single most interesting point",
    DEEP: "a DEEPER version: 90-130 words adding mechanism, context or a second supporting detail — still one coherent idea, no lists",
    EXTRA_DEEP:
      "an EXTRA-DEEP version: a 300-450 word mini-article in 3-5 short paragraphs separated by blank lines — explain the mechanism, add history or wider context, and end on a surprising implication. Flowing prose only: no headings, no lists",
  } as const;
  const spec = specs[level];

  const prompt = `Rewrite this learning card as ${spec}. Stay strictly within the facts of the original — do not introduce new claims that its sources would not support.

Original title: ${card.title}
Original body: ${card.body}

Respond with JSON only: {"title": "...", "body": "..."}`;

  let variant;
  let model = "";
  try {
    const result = await generateJSON(prompt, { interactive: true });
    model = result.model;
    variant = variantSchema.parse(JSON.parse(result.text));
  } catch {
    return NextResponse.json({ error: "generation failed" }, { status: 502 });
  }

  const created = await prisma.card.create({
    data: {
      categoryId: card.categoryId,
      type: card.type,
      title: variant.title,
      body: variant.body,
      imageUrl: card.imageUrl,
      sources: card.sources as object[],
      readMoreUrl: card.readMoreUrl,
      // Same sources as the validated standard card, so it inherits publish.
      published: true,
      contentHash: contentHash({ category: card.categoryId, title: variant.title, body: variant.body }),
      depthGroupId: card.depthGroupId,
      depthLevel: level,
      modelUsed: model,
    },
  });

  return NextResponse.json({
    card: { id: created.id, title: created.title, body: created.body, depthLevel: level },
    generated: true,
  });
}
