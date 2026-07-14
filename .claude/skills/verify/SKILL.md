---
name: verify
description: How to run and drive Sparklet locally to verify changes end-to-end (auth, feed, APIs, headless browser).
---

# Verifying Sparklet changes

## Launch

- Local Postgres: Homebrew postgresql@16, socket `/tmp`, db `sparklet` (`psql -h /tmp sparklet`).
- The user's own dev server often occupies :3000 — run yours on another port: `PORT=3001 npm run dev` (background). Dev server output logs magic links.
- Schema changes: `npx prisma migrate dev` trips over the hand-written `search` tsvector generated column (P3018, "generated column"). Fix: delete the spurious `ALTER COLUMN "search" DROP DEFAULT` from the generated SQL, `npx prisma migrate resolve --rolled-back <name>`, then `npx prisma migrate deploy`.

## Authenticate via curl (magic link)

Auth.js v5 provider id is `nodemailer`, NOT `email`:

```sh
JAR=cookies.txt
CSRF=$(curl -s -c $JAR http://localhost:3001/api/auth/csrf | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
curl -s -b $JAR -c $JAR -X POST http://localhost:3001/api/auth/signin/nodemailer \
  -d "csrfToken=$CSRF&email=jaydend93%40gmail.com"
# magic link appears in the dev-server console (EMAIL_SERVER empty in dev):
grep -o "http://localhost:300./api/auth/callback/nodemailer[^ \"']*" <dev-server-log> | tail -1
# follow it (rewrite the port to yours) with -b/-c $JAR → session cookie set
```

Session cookie name: `authjs.session-token`.

## Drive the surfaces

- APIs: curl with the cookie jar — `/api/feed?take=10`, `/api/interactions`, `/api/quiz/<id>/answer`, `/api/guess/<id>/answer` (all take `tzOffsetMinutes`).
- Real browser without installing anything: Playwright's chromium is cached at
  `~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
  `npm i playwright-core` in the scratchpad and launch with `executablePath` pointing there; inject the session cookie via `context.addCookies`. Keyboard `ArrowDown` pages the feed.
- Reset interaction state between runs (feed pools exclude seen/attempted):
  `psql -h /tmp sparklet -c 'delete from "UserGuessAttempt"; delete from "UserQuizAttempt"; delete from "UserCardInteraction" where ...;'`

## Content for testing

- `ENRICH_MAX_PER_RUN=12 npx tsx scripts/enrich-cards.ts` creates real quizzes/guesses for existing published cards (needs AI keys in `.env`; Gemini free tier 429s easily — the script retries then falls back to Groq).

## Gotchas

- Editing `globals.css` while the dev server is **down** can leave Turbopack's
  persistent cache serving a stale CSS chunk after restart (new classes
  silently missing; `getComputedStyle` shows `animationName: none`). Fix:
  `rm -rf .next` and restart. Confirm by grepping the served chunk:
  `curl -s http://localhost:3001/_next/static/chunks/<css> | grep -o "@keyframes [a-z-]*"`.

- `notFound()` on pages with a `loading.tsx` streams the 404 UI with HTTP **200** (documented Next behavior for streamed responses) — don't chase it as a bug; check body text not status.
- Service worker only registers in prod builds; dev verification never hits it.
