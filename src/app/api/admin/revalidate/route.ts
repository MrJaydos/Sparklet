import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Re-checks source URLs of already-published cards — links rot after launch,
 * not just at generation time. Called in batches by the weekly GitHub Action
 * (Authorization: Bearer $REVALIDATE_TOKEN); each call processes the oldest-
 * validated slice and returns progress so the caller can loop.
 *
 * Cards with a dead link are unpublished with a reviewNote, landing in the
 * existing /admin "Cards awaiting review" queue — no separate queue.
 */

const BATCH_SIZE = 25;
const UA = "SparkletBot/1.0 (source revalidation; contact: admin@sparklet)";

async function urlIsAlive(url: string): Promise<boolean> {
  const attempt = async (method: "HEAD" | "GET") => {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(10_000),
    });
    return res.status;
  };
  for (let retry = 0; retry < 2; retry++) {
    try {
      let status = await attempt("HEAD");
      if (status >= 400 && status !== 429 && status !== 503) status = await attempt("GET");
      if (status >= 200 && status < 400) return true;
      // Throttled ≠ dead — never unpublish over a rate limit.
      if (status === 429 || status === 503) return true;
      return false;
    } catch {
      if (retry === 0) await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return true; // network flake: err on the side of keeping the card live
}

export async function POST(req: NextRequest) {
  const token = process.env.REVALIDATE_TOKEN;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || provided !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Oldest-validated first; only cards not checked in the last 6 days, so
  // repeated batch calls within one weekly run never re-process a card.
  const cutoff = new Date(Date.now() - 6 * 86_400_000);
  const cards = await prisma.card.findMany({
    where: {
      published: true,
      OR: [{ lastValidatedAt: null }, { lastValidatedAt: { lt: cutoff } }],
    },
    orderBy: [{ lastValidatedAt: { sort: "asc", nulls: "first" } }],
    take: BATCH_SIZE,
    select: { id: true, title: true, readMoreUrl: true, sources: true },
  });

  let unpublished = 0;
  for (const card of cards) {
    const urls = [
      ...(card.sources as { url: string }[]).map((s) => s.url),
      card.readMoreUrl,
    ];
    const dead: string[] = [];
    for (const url of urls) {
      if (!(await urlIsAlive(url))) dead.push(url);
    }
    if (dead.length) {
      await prisma.card.update({
        where: { id: card.id },
        data: {
          published: false,
          reviewNote: `Link rot on re-validation: ${dead.join(", ")}`,
          lastValidatedAt: new Date(),
        },
      });
      unpublished++;
    } else {
      await prisma.card.update({
        where: { id: card.id },
        data: { lastValidatedAt: new Date() },
      });
    }
  }

  const remaining = await prisma.card.count({
    where: {
      published: true,
      OR: [{ lastValidatedAt: null }, { lastValidatedAt: { lt: cutoff } }],
    },
  });

  return NextResponse.json({ checked: cards.length, unpublished, remaining, done: remaining === 0 });
}
