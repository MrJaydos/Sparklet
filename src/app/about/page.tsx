import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Sparklet",
  description:
    "Who makes Sparklet, how its learning cards are written and fact-checked, and how sources are cited.",
};

// Static: nothing here reads the DB, so unlike the content pages this one can
// be prerendered at build time.
export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-12 text-neutral-100">
      <div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to Sparklet
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">About Sparklet</h1>
      </div>

      <p className="leading-relaxed text-neutral-300">
        Sparklet is a learning feed. Instead of an endless scroll you finish
        feeling worse about, you get short, specific, sourced facts — each one
        backed by a full article you can read if it catches your interest.
      </p>

      <section>
        <h2 className="text-lg font-bold">How a card is made</h2>
        <p className="mt-2 leading-relaxed text-neutral-300">
          Cards are drafted with the help of large language models, then put
          through automated checks before anything is published. We say this
          plainly because you deserve to know how what you are reading was
          produced.
        </p>
        <ul className="mt-3 space-y-2 text-neutral-300">
          <li>
            <strong className="text-neutral-100">Every cited link is fetched.</strong>{" "}
            A card whose source URL is dead, or which sits behind a paywall a
            reader cannot get past, is not published.
          </li>
          <li>
            <strong className="text-neutral-100">A second model checks the first.</strong>{" "}
            The provider that did not write a card reads the actual text of its
            sources and judges whether they support its specific claims —
            names, numbers, dates. Contradicted cards are held for review
            rather than published.
          </li>
          <li>
            <strong className="text-neutral-100">Near-duplicates are dropped.</strong>{" "}
            New cards are compared against everything already published so the
            feed does not repeat itself in different words.
          </li>
          <li>
            <strong className="text-neutral-100">Publishers are derived from the URL.</strong>{" "}
            The name shown on a source is taken from the link&apos;s own domain,
            never from a label a model wrote — so an attribution can never
            claim an institution the link does not actually go to.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-bold">Corrections</h2>
        <p className="mt-2 leading-relaxed text-neutral-300">
          Automated checks catch a lot and will never catch everything. Every
          card has a report control, and reported cards are pulled from the
          feed for human review. If you spot something wrong, telling us is the
          fastest way to get it fixed —{" "}
          <Link href="/contact" className="text-violet-400 underline-offset-4 hover:underline">
            get in touch
          </Link>
          .
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold">Start reading</h2>
        <p className="mt-2 leading-relaxed text-neutral-300">
          Browse{" "}
          <Link href="/explore" className="text-violet-400 underline-offset-4 hover:underline">
            every topic
          </Link>{" "}
          or jump straight into{" "}
          <Link href="/feed" className="text-violet-400 underline-offset-4 hover:underline">
            the feed
          </Link>
          . No account needed to read.
        </p>
      </section>
    </main>
  );
}
