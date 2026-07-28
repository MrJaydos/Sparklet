import Link from "next/link";

export const metadata = { title: "Privacy Policy — Sparklet" };

const LAST_UPDATED = "July 28, 2026";
const CONTACT_EMAIL = "privacy@sparkletapp.com";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-12 text-neutral-100">
      <div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Back to Sparklet
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>
      </div>

      <div className="flex flex-col gap-8 text-neutral-300 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-neutral-100 [&_p]:leading-relaxed [&_li]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
        <section>
          <p>
            Sparklet (&quot;we&quot;, &quot;us&quot;) is a learning app that shows short,
            fact-checked cards with quizzes and spaced-repetition review. This policy
            explains what data we collect, why, and what choices you have about it. See
            also our{" "}
            <Link href="/terms" className="text-violet-400 underline hover:text-violet-300">
              Terms of Service
            </Link>
            .
          </p>
        </section>

        <section>
          <h2>Information we collect</h2>
          <p>When you create an account, we collect:</p>
          <ul>
            <li>
              Your email address, used for magic-link sign-in and account identification.
            </li>
            <li>
              If you sign in with Google or Apple, the name and email address those
              providers share with us. Apple only shares your name the first time you
              authorize the app.
            </li>
          </ul>
          <p className="mt-3">As you use the app, we collect:</p>
          <ul>
            <li>
              Learning activity — which cards you&apos;ve read, quiz and challenge
              answers, XP, streaks, and spaced-repetition review timing — so we can run
              the feed, leaderboard, and review reminders.
            </li>
            <li>
              Friend connections and referral links, if you use those features.
            </li>
            <li>
              A push notification subscription, only if you opt in to reminders.
            </li>
            <li>
              Your device timezone, used to calculate your daily streak and goals
              correctly for your local day.
            </li>
          </ul>
          <p className="mt-3">
            Some preferences — topic filters, reading depth, and your daily card goal —
            are stored only in your browser&apos;s local storage and are never sent to
            our servers.
          </p>
        </section>

        <section>
          <h2>How we use your information</h2>
          <ul>
            <li>To operate your account, sign-in, and progress across sessions.</li>
            <li>To run XP, streaks, the leaderboard, and spaced-repetition reviews.</li>
            <li>To send optional push notifications, if you&apos;ve enabled them.</li>
            <li>
              To show ads to free-tier users, and to process payments for anyone who
              subscribes to remove ads or unlock extra reading depth.
            </li>
            <li>To maintain and secure the service, and to fix bugs.</li>
          </ul>
        </section>

        <section>
          <h2>Cookies and similar technologies</h2>
          <p>
            We use a small number of essential cookies to keep you signed in and to
            record your timezone. If ads are shown on the site, Google AdSense may set
            its own cookies to serve and measure ads — see{" "}
            <a
              href="https://policies.google.com/technologies/partner-sites"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 underline hover:text-violet-300"
            >
              how Google uses information from sites that use its services
            </a>
            . Where required by law, we&apos;ll ask for your consent before showing
            personalized ads.
          </p>
        </section>

        <section>
          <h2>Who we share data with</h2>
          <p>We don&apos;t sell your data. We share it only with:</p>
          <ul>
            <li>
              Service providers who host the app and database, send sign-in emails, and
              deliver push notifications, strictly to provide those services to you.
            </li>
            <li>Google and Apple, if you choose to sign in with those providers.</li>
            <li>Google AdSense, to serve ads to free-tier users.</li>
            <li>
              Stripe, to process payments if you subscribe — we never see or store your
              full card details.
            </li>
          </ul>
        </section>

        <section>
          <h2>Data retention and deletion</h2>
          <p>
            We keep your account data for as long as your account is active. You can
            request deletion of your account and associated data at any time by
            contacting us below — this removes your profile, activity history, and
            connections. Some information may be retained briefly where we&apos;re
            required to for legal, security, or fraud-prevention reasons.
          </p>
        </section>

        <section>
          <h2>Your rights</h2>
          <p>
            Depending on where you live, you may have the right to access, correct,
            export, or delete your personal data, or to object to certain processing.
            To exercise any of these rights, contact us at the email below and
            we&apos;ll respond as required by applicable law.
          </p>
        </section>

        <section>
          <h2>Children&apos;s privacy</h2>
          <p>
            Sparklet is not directed at children under 13, and we don&apos;t knowingly
            collect personal information from them. If you believe a child has created
            an account, contact us and we&apos;ll remove it.
          </p>
        </section>

        <section>
          <h2>Changes to this policy</h2>
          <p>
            We may update this policy from time to time. We&apos;ll update the
            &quot;Last updated&quot; date above when we do, and for significant changes
            we&apos;ll make a reasonable effort to let you know in the app.
          </p>
        </section>

        <section>
          <h2>Contact us</h2>
          <p>
            Questions about this policy or your data? Email us at{" "}
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
