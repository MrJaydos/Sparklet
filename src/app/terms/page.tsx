import Link from "next/link";

export const metadata = { title: "Terms of Service — Sparklet" };

const LAST_UPDATED = "July 28, 2026";
const CONTACT_EMAIL = "privacy@sparkletapp.com";

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-12 text-neutral-100">
      <div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to Sparklet
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="flex flex-col gap-8 text-neutral-300 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-neutral-100 [&_p]:leading-relaxed [&_li]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
        <section>
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your use of Sparklet. By
            creating an account or using the app, you agree to these Terms. If you
            don&apos;t agree, please don&apos;t use Sparklet. See also our{" "}
            <Link href="/privacy" className="text-violet-400 underline hover:text-violet-300">
              Privacy Policy
            </Link>
            , which explains how we handle your data.
          </p>
        </section>

        <section>
          <h2>The service</h2>
          <p>
            Sparklet is a learning app that shows short, sourced cards, quizzes, and
            spaced-repetition reviews, and tracks your progress through XP, streaks,
            and a leaderboard. We work to keep cards accurate and properly sourced, but
            content is provided for informational and educational purposes only — it
            isn&apos;t professional, medical, financial, or legal advice, and we
            don&apos;t guarantee it&apos;s complete or error-free.
          </p>
        </section>

        <section>
          <h2>Accounts</h2>
          <ul>
            <li>You must be at least 13 years old to use Sparklet.</li>
            <li>
              You&apos;re responsible for keeping your sign-in access secure and for
              activity that happens under your account.
            </li>
            <li>Provide accurate information when you sign up.</li>
          </ul>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>
              Use bots, scripts, or other automated means to farm XP, streaks, or
              rewards, or otherwise manipulate the leaderboard or scoring systems.
            </li>
            <li>Scrape, copy, or redistribute card content or app data in bulk.</li>
            <li>Attempt to disrupt, overload, or gain unauthorized access to the service.</li>
            <li>
              Submit abusive, illegal, or harassing content through explanations,
              comments, reports, or any other free-text feature.
            </li>
            <li>Impersonate another person or misrepresent your identity.</li>
          </ul>
          <p className="mt-3">
            We may suspend or terminate accounts that violate these Terms, at our
            discretion.
          </p>
        </section>

        <section>
          <h2>Your content</h2>
          <p>
            When you submit text — for example, an explain-it-back answer or a card
            report — you keep ownership of it, but you grant us a license to store,
            process, and use it (including sending it to third-party AI providers) to
            operate features like automated grading and content review.
          </p>
        </section>

        <section>
          <h2>Subscriptions and payments</h2>
          <p>
            Sparklet is free to use, supported by ads. An optional paid subscription
            removes ads and unlocks additional reading depth. Subscriptions are billed
            through Stripe, renew automatically until canceled, and you can cancel
            anytime from your account — cancellation stops future renewals but doesn&apos;t
            retroactively refund the current billing period unless required by law.
          </p>
        </section>

        <section>
          <h2>Intellectual property</h2>
          <p>
            The Sparklet name, app, and software are ours. Card content is drawn from
            and cited to third-party sources, which retain their own rights — we
            reference and summarize that material, we don&apos;t claim ownership of it.
          </p>
        </section>

        <section>
          <h2>Termination</h2>
          <p>
            You can stop using Sparklet and request account deletion at any time. We
            may suspend or terminate access to the service, with or without notice, for
            conduct we believe violates these Terms or harms other users or the
            service.
          </p>
        </section>

        <section>
          <h2>Disclaimer and limitation of liability</h2>
          <p>
            Sparklet is provided &quot;as is&quot; without warranties of any kind. To
            the fullest extent permitted by law, we aren&apos;t liable for indirect,
            incidental, or consequential damages arising from your use of the service.
          </p>
        </section>

        <section>
          <h2>Governing law</h2>
          <p>
            These Terms are governed by the laws of Queensland, Australia, without
            regard to conflict of law principles, and any disputes arising from them
            will be handled in the courts of Queensland, Australia.
          </p>
        </section>

        <section>
          <h2>Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. We&apos;ll update the
            &quot;Last updated&quot; date above when we do, and for significant changes
            we&apos;ll make a reasonable effort to let you know in the app.
          </p>
        </section>

        <section>
          <h2>Contact us</h2>
          <p>
            Questions about these Terms? Email us at{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-violet-400 underline hover:text-violet-300"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
