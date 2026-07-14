import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { OnboardingGrid } from "@/components/OnboardingGrid";

export const metadata = { title: "Pick your interests — Sparklet" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true, colorHex: true, icon: true },
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-10">
      <h1 className="text-3xl font-bold">What sparks your curiosity?</h1>
      <p className="mt-2 text-neutral-400">
        Pick at least 3 topics — your feed will show just these. You can widen
        or switch topics anytime from the feed.
      </p>
      <OnboardingGrid categories={categories} />
    </main>
  );
}
