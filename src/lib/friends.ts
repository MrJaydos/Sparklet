import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

// No 0/O, 1/I/L — avoids characters that look alike when someone reads the
// code out loud or copies it by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 7;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Every account gets one lazily, on first need — a fallback to adding
 *  friends by email, which silently no-ops on a typo (by design, to avoid
 *  using email as an account-existence oracle). Collisions retry; the
 *  32-symbol/7-char space (~3.4e10) makes a second collision vanishingly
 *  unlikely. */
export async function ensureFriendCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { friendCode: true },
  });
  if (existing.friendCode) return existing.friendCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      await prisma.user.update({ where: { id: userId }, data: { friendCode: code } });
      return code;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Could not generate a unique friend code");
}
