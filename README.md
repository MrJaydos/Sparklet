# ✨ Sparklet

A TikTok-style vertical feed where every card is a short, fact-checked piece of
learning — real sources on every card, streaks that reward learning instead of
time-on-app, and a user-set daily goal the feed actually ends on, instead of
infinite-scroll traps.

**Stack:** Next.js (App Router, TS) · Tailwind · PostgreSQL + Prisma ·
Auth.js (magic-link email) · Gemini/Groq content generation · Docker + Coolify.

## Local development

Requires Node 22 and a running Postgres.

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL + AUTH_SECRET at minimum
npx prisma migrate dev        # create/update schema
npm run db:seed               # seed the 12 categories
npm run seed:content          # import cards from /content (validates all URLs)
npm run dev
```

Magic-link sign-in in dev: leave `EMAIL_SERVER` empty and the link is printed
to the dev-server console instead of emailed.

## Content pipeline

Content and deployment are the same pipeline — no separate worker:

1. **Generate**: `npm run generate:content -- --all --count 30` (seed bank) or
   `-- --top-up` (only categories whose published-card count is below
   `MIN_BANK`, read from the live app's `/api/inventory`). Tries Gemini 2.5
   Flash first, falls back to Groq Llama 3.3 70B on 429/5xx. Output lands in
   `content/generated/<category>/<timestamp>.json`.
2. **Import**: `npm run seed:content` (runs automatically on every deploy via
   `start:prod`). Dedupes by content hash and **HEAD/GET-checks every source
   URL** — cards with any dead link stay `published: false` with a
   `reviewNote` instead of shipping a broken citation.
3. **Schedule**: `.github/workflows/generate-content.yml` runs daily, commits
   new JSON to `main`, which triggers Coolify's webhook → rebuild → import.

Hand-written cards live in `content/curated/` and go through the same
validation. A future option: Gemini's search-grounding tool further reduces
hallucinated citations if enabled on your API tier — URL validation is the
safety net either way.

### Required GitHub secrets (for the scheduled top-up)

| Secret | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Primary generator (aistudio.google.com, free tier) |
| `GROQ_API_KEY` | Fallback provider (console.groq.com, free tier) |
| `APP_URL` | Deployed app URL, e.g. `https://sparklet.example.com` |

Optional repo **variables**: `MIN_BANK` (default 40), `TOPUP_COUNT` (default 10).

## Deployment (Coolify)

Coolify watches `main` on GitHub and rebuilds on push using the
`docker-compose.yaml` (app + Postgres). Set the env vars from
`.env.example` in Coolify's UI. The container's start command
(`npm run start:prod`) runs `prisma migrate deploy` + both seed steps before
`next start`, so **every** deploy — code or content-only — leaves the DB
current. Health check: `GET /api/health` (also wired as the Docker
healthcheck).

## App-store path (planned)

The backend is deliberately API-first: all feed/interaction/inventory
operations are plain JSON routes under `/api`, so a native client can reuse
them unchanged.

1. **Now**: installable PWA (manifest + icons shipped); listable on Google
   Play via a Trusted Web Activity.
2. **Next**: Capacitor wrapper around the deployed app for real iOS/Android
   binaries.
3. **Later**: Expo/React Native client against the same `/api` routes.

## Pre-launch checklist

- [ ] Domain purchase + final trademark check for "Sparklet" (incl. IPONZ, NZ)
- [ ] SMTP provider for magic links (e.g. Resend) → `EMAIL_SERVER`
- [ ] `GEMINI_API_KEY` / `GROQ_API_KEY` in `.env` (local) and GitHub secrets (CI)
- [ ] Generate the real seed bank: `npm run generate:content -- --all --count 30`
- [ ] Review any cards held back with a `reviewNote` (dead source links)
