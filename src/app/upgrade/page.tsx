import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getStripe } from "@/lib/billing";
import { UpgradeClient } from "./UpgradeClient";

export const metadata = { title: "Upgrade — Sparklet" };
export const dynamic = "force-dynamic";

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fupgrade");

  if (!getStripe()) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-24 text-center">
        <p className="text-neutral-400">Premium isn&apos;t available yet — check back soon.</p>
        <Link href="/feed" className="mt-4 inline-block text-sm text-violet-400 hover:underline">
          ← Back to feed
        </Link>
      </main>
    );
  }

  const { status } = await searchParams;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-8 pt-24">
      <Link href="/feed" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Back to feed
      </Link>
      <h1 className="mt-4 text-2xl font-bold">✨ Sparklet Premium</h1>
      <p className="mt-1 text-sm text-neutral-400">
        No ads, and unlimited Deeper / Extra-deep reading on every card. Cancel anytime.
      </p>
      {status === "cancel" && (
        <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
          Checkout was cancelled — no charge was made.
        </p>
      )}
      <div className="mt-6">
        <UpgradeClient premium={session.user.premium} activating={status === "success"} />
      </div>
    </main>
  );
}
