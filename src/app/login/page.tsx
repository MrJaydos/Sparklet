import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const metadata = { title: "Sign in — Sparklet" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  const appleEnabled = !!(process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET);

  async function loginAction(formData: FormData) {
    "use server";
    await signIn("nodemailer", formData, { redirectTo: "/feed" });
  }

  async function googleAction() {
    "use server";
    await signIn("google", { redirectTo: "/feed" });
  }

  async function appleAction() {
    "use server";
    await signIn("apple", { redirectTo: "/feed" });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">✨ Sparklet</h1>
        <p className="mt-2 text-neutral-400">
          Learn something real, one swipe at a time.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        {googleEnabled && (
          <form action={googleAction}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 font-semibold text-neutral-100 transition hover:bg-neutral-800"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.54-5.17 3.54-8.65z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11C3.24 21.3 7.29 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.62H1.27a12 12 0 0 0 0 10.76z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.29 0 3.24 2.7 1.27 6.62l4 3.11C6.22 6.86 8.87 4.75 12 4.75z"
                />
              </svg>
              Continue with Google
            </button>
          </form>
        )}
        {appleEnabled && (
          <form action={appleAction}>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-neutral-200"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="currentColor">
                <path d="M16.365 1.43c0 1.14-.462 2.24-1.212 3.05-.83.9-2.18 1.6-3.29 1.51-.15-1.1.44-2.26 1.2-3.03.83-.86 2.28-1.5 3.3-1.53zM20.5 17.34c-.55 1.27-.81 1.84-1.52 2.96-.99 1.56-2.38 3.5-4.11 3.51-1.53.02-1.93-1-4.01-.99-2.08.01-2.52.99-4.05 1-1.73.01-3.05-1.76-4.04-3.31C.4 17.4-.55 12.75 1.06 9.65c.87-1.68 2.42-2.74 4.11-2.76 1.52-.02 2.96 1.03 3.9 1.03.93 0 2.68-1.27 4.52-1.09.77.03 2.93.31 4.32 2.34-.11.07-2.58 1.51-2.55 4.5.03 3.58 3.14 4.77 3.19 4.79-.03.09-.5 1.7-1.65 3.36l1.6-.08z" />
              </svg>
              Continue with Apple
            </button>
          </form>
        )}
        {(googleEnabled || appleEnabled) && (
          <div className="my-1 flex items-center gap-3 text-xs text-neutral-500">
            <span className="h-px flex-1 bg-neutral-800" />
            or
            <span className="h-px flex-1 bg-neutral-800" />
          </div>
        )}
        <form action={loginAction} className="flex flex-col gap-3">
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
      </div>
    </main>
  );
}
