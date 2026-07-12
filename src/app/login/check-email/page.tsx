export const metadata = { title: "Check your email — Sparklet" };

export default function CheckEmailPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl">📬</div>
      <h1 className="text-2xl font-bold">Check your email</h1>
      <p className="max-w-sm text-neutral-400">
        We sent you a sign-in link. Click it on this device to jump into your
        feed. The link expires in 24 hours.
      </p>
    </main>
  );
}
