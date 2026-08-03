import { prisma } from "@/lib/db";

/** Admins are configured via ADMIN_EMAILS (comma-separated) — no DB roles. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * Permanently rejects a card: records its contentHash so seed-content.ts
 * (which reprocesses every file under content/generated/ on every deploy)
 * never reimports the same generated content, then deletes the row. Plain
 * `card.delete` alone would free the hash for reimport on the next deploy.
 */
export async function rejectCard(cardId: string) {
  const card = await prisma.card.findUnique({ where: { id: cardId }, select: { contentHash: true } });
  if (!card) return;
  await prisma.rejectedContentHash.upsert({
    where: { contentHash: card.contentHash },
    update: {},
    create: { contentHash: card.contentHash, reason: "Deleted by admin" },
  });
  await prisma.card.delete({ where: { id: cardId } });
}
