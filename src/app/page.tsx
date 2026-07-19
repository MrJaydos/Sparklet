import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-5xl font-bold tracking-tight">✨ Sparklet</h1>
        <p className="mt-4 max-w-md text-lg text-neutral-400">
          The scroll you don&apos;t regret. Bite-size, fact-checked learning —
          every card cites real sources you can verify.
        </p>
      </div>
      <ul className="max-w-md space-y-2 text-left text-neutral-300">
        <li>⚡ 10–30 second cards, endless variety</li>
        <li>🎯 Pin your feed to topics you love — or explore everything</li>
        <li>🔗 Real sources on every single card</li>
        <li>🔥 Streaks that reward learning, not just scrolling</li>
      </ul>
      <div className="flex flex-col items-center gap-3">
        <Link
          href="/feed"
          className="rounded-xl bg-violet-600 px-8 py-3 text-lg font-semibold text-white transition hover:bg-violet-500"
        >
          Start scrolling
        </Link>
        <Link href="/login" className="text-sm text-neutral-500 underline-offset-4 hover:underline">
          Already have an account? Sign in
        </Link>
      </div>
    </main>
  );
}
