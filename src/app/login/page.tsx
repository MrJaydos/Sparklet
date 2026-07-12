import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const metadata = { title: "Sign in — Sparklet" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  async function loginAction(formData: FormData) {
    "use server";
    await signIn("nodemailer", formData, { redirectTo: "/feed" });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">✨ Sparklet</h1>
        <p className="mt-2 text-neutral-400">
          Learn something real, one swipe at a time.
        </p>
      </div>
      <form action={loginAction} className="flex w-full max-w-sm flex-col gap-3">
        <label htmlFor="email" className="text-sm text-neutral-400">
          We&apos;ll email you a sign-in link. No password needed.
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-base outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          className="rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-500"
        >
          Send magic link
        </button>
      </form>
    </main>
  );
}
