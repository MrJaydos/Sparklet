import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact — Sparklet",
  description:
    "How to reach Sparklet about a factual correction, a privacy request, or anything else.",
};

// Matches the address already published on /privacy and /terms — one mailbox,
// so a reader never has to guess which one is monitored.
const CONTACT_EMAIL = "privacy@sparkletapp.com";

export default function ContactPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-12 text-neutral-100">
      <div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to Sparklet
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Contact</h1>
      </div>

      <p className="leading-relaxed text-neutral-300">
        Email{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="text-violet-400 underline-offset-4 hover:underline"
        >
          {CONTACT_EMAIL}
        </a>{" "}
        and a human will read it.
      </p>

      <section>
        <h2 className="text-lg font-bold">Reporting a factual error</h2>
        <p className="mt-2 leading-relaxed text-neutral-300">
          This is the most useful thing you can send us. Include the card&apos;s
          title or link and what is wrong with it. Cards can also be reported
          directly from the feed, which pulls them for review immediately —
          that is faster than email if you are already reading.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">Privacy and your data</h2>
        <p className="mt-2 leading-relaxed text-neutral-300">
          Account deletion and data requests go to the same address. What we
          store and why is set out in the{" "}
          <Link href="/privacy" className="text-violet-400 underline-offset-4 hover:underline">
            privacy policy
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">Everything else</h2>
        <p className="mt-2 leading-relaxed text-neutral-300">
          Topic suggestions are best made in the app — the &ldquo;Suggest a
          card&rdquo; option in the feed menu feeds directly into what gets
          written next. For anything else, email works.
        </p>
      </section>
    </main>
  );
}
