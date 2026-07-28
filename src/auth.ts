import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { createTransport } from "nodemailer";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isPremium } from "@/lib/billing";

const { handlers, auth: cookieAuth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  debug: true,
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      // `user` here is the full Prisma row from the adapter — no extra query.
      session.user.premium = isPremium(user);
      return session;
    },
  },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
  providers: [
    // Credentials come from AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET and
    // AUTH_APPLE_ID/AUTH_APPLE_SECRET (Auth.js v5 env-var convention —
    // see .env.example). Both providers verify email ownership themselves,
    // so it's safe to auto-link them onto an existing magic-link account
    // that shares the same email rather than erroring the user into a
    // second, disconnected account.
    Google({ allowDangerousEmailAccountLinking: true }),
    // Apple's authorize endpoint requires scopes space-separated as "%20",
    // but Auth.js builds this URL with URLSearchParams, which always encodes
    // a space as "+" — Apple doesn't decode "+" back to a space (unlike most
    // OAuth servers), so the default "name email" scope arrives as one
    // invalid token and Apple rejects the whole sign-in before it reaches us.
    // There's no Auth.js config hook to fix that encoding, so the login
    // page's appleAction calls signIn with `redirect: false`, fixes up the
    // returned URL's scope encoding itself, and redirects manually — see
    // src/app/login/page.tsx.
    Apple({
      allowDangerousEmailAccountLinking: true,
      // The default profile() assumes profile.user.name is always present
      // whenever profile.user exists. That only holds on a user's very first
      // authorization ever for this app — every sign-in after that, Apple
      // sends no `user` object at all regardless of scope, so the default
      // callback's `.name.firstName` read is never reached in practice, but
      // guard it anyway rather than depend on that.
      profile(profile) {
        const name = profile.user?.name
          ? `${profile.user.name.firstName} ${profile.user.name.lastName}`
          : profile.email;
        return {
          id: profile.sub,
          name,
          email: profile.email,
          image: null,
        };
      },
    }),
    Nodemailer({
      // The dummy dev value is never used — sendVerificationRequest logs the
      // link instead of sending when EMAIL_SERVER is unset.
      server: process.env.EMAIL_SERVER || "smtp://localhost:2525",
      from: process.env.EMAIL_FROM ?? "Sparklet <login@localhost>",
      async sendVerificationRequest({ identifier, url, provider }) {
        // Dev fallback: no SMTP configured — surface the link in the server log.
        if (!process.env.EMAIL_SERVER) {
          console.log(`\n✨ Sparklet magic link for ${identifier}:\n${url}\n`);
          return;
        }
        const transport = createTransport(provider.server);
        await transport.sendMail({
          to: identifier,
          from: provider.from,
          subject: "Sign in to Sparklet",
          text: `Sign in to Sparklet:\n${url}\n\nIf you didn't request this, you can ignore this email.`,
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h1 style="font-size:20px">✨ Sign in to Sparklet</h1>
              <p>Click the button below to sign in. This link expires in 24 hours.</p>
              <p style="margin:24px 0">
                <a href="${url}" style="background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Sign in</a>
              </p>
              <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
            </div>`,
        });
      },
    }),
  ],
});

// Bearer-token fallback for native clients (iOS/Android) that can't carry
// the session cookie — see src/lib/mobile-auth.ts and the /api/auth/mobile-*
// routes for how a token is issued. headers()/cookies() are both
// request-scoped via AsyncLocalStorage, so this resolves correctly in Server
// Components, Server Actions, and Route Handlers exactly like cookieAuth()
// does; it would NOT work inside middleware (this repo has no middleware.ts,
// so that's moot today — but don't add one that imports this without
// re-checking). An invalid or expired Bearer token returns null outright
// rather than falling through to cookie auth: a bad Bearer must never
// silently become "check the browser cookie instead".
export async function auth(): Promise<Session | null> {
  const authHeader = (await headers()).get("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return cookieAuth();

  const now = new Date();
  const session = await prisma.session.findUnique({
    where: { sessionToken: bearer },
    include: { user: true },
  });
  if (!session || session.expires < now) return null;

  // Sliding expiry: the Bearer path bypasses Auth.js's own session-refresh
  // (that only runs on cookie requests), so extend on use once within a week
  // of expiring rather than hard-logging-out every mobile user exactly 30
  // days after their last sign-in.
  if (session.expires.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
    await prisma.session
      .update({
        where: { sessionToken: bearer },
        data: { expires: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
      })
      .catch(() => {});
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
      premium: isPremium(session.user),
    },
    expires: session.expires.toISOString(),
  };
}

export { handlers, signIn, signOut };
