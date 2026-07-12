import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { createTransport } from "nodemailer";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
  providers: [
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
