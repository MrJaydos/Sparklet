<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

In this codebase specifically: route `params` and `searchParams` are Promises (`const { id } = await params`) and `cookies()` is async.

# Sparklet

TikTok-style vertical learning feed: short fact-checked cards with real sources, quizzes, guess-before-reveal challenges, XP/streaks/leaderboard, spaced repetition. Next.js App Router (TS) · Tailwind v4 · PostgreSQL + Prisma 7 · Auth.js v5 magic-link · installable PWA. Deployed via Coolify (Docker) off pushes to `main`.

## Commands

```bash
npm run dev                # dev server (the user's own often occupies :3000 — use PORT=3001)
npm run lint               # eslint
npx tsc --noEmit           # typecheck (no test suite exists; this + lint is the bar)
npx prisma migrate dev     # apply/create migrations locally (needs Postgres)
npm run db:seed            # seed categories
npm run seed:content       # import /content JSON (validates every source URL — slow)
npm run generate:content -- --category sales --count 10   # or --all / --top-up
```

Deploys run `scripts/start-prod.sh`: `prisma migrate deploy` + category seed block startup; content import, card enrichment, and audio pre-gen run in the background after. A schema migration committed to `main` applies itself on the next deploy — no manual step.

For end-to-end verification (auth via curl, driving the feed, DB resets, known gotchas), follow `.claude/skills/verify/SKILL.md`.

## Architecture — the content pipeline is the app

Generation happens in CI **without DB access**; the DB is only written at deploy time. This split shapes everything:

1. **Generate** (`scripts/generate-content.ts`, nightly GH Action `generate-content.yml` at 17:00 UTC): reads the live app's public `/api/inventory`, writes validated JSON to `content/generated/<category>/<timestamp>.json`, commits to `main` — which itself triggers a deploy. Provider: Gemini first, Groq (llama) fallback (`src/lib/ai-provider.ts`); Gemini free-tier quota (~250 req/day) is why runs cap categories per night.
2. **Top-up thresholds are demand-aware**: a category needs `max(MIN_BANK=40, maxSeen + TOPUP_HEADROOM=15)` published STANDARD cards, where `maxSeen` = most cards any recently-active user has completed (so heavy readers never run dry). **Groq-generated cards don't count toward the bank** — they're placeholders; the importer retires them (unpublish, worst score first, never saved ones) once Gemini replacements keep the total at/above the minimum.
3. **Import** (`scripts/seed-content.ts`, every deploy): dedupes by `contentHash`, HEAD/GET-checks every source URL (dead link → `published: false` + `reviewNote`, lands in the /admin review queue), embedding near-duplicate check, cross-model fact-check (the provider that did NOT generate the card verifies it against fetched source text). Never bypass these gates when adding card-creating code.
4. Cards have depth variants (SIMPLE/DEEP/EXTRA_DEEP) as **separate Card rows** sharing `depthGroupId`, generated lazily via `/api/cards/[id]/depth`. The feed serves only `depthLevel: STANDARD` — every card count in the app (inventory, admin, retirement) must filter on that or it overcounts.

Other scheduled jobs: `revalidate-sources.yml` (weekly link-rot check) and `send-nudges.yml` (2-hourly push nudges) both curl token-authed `/api/admin/*` endpoints using the `REVALIDATE_TOKEN` shared cron secret.

## Architecture — engagement integrity

Client claims are verified server-side; keep it that way:

- A card view counts as "read" (`UserCardInteraction.completed` → XP, streak, review recall, the `maxSeen` demand signal) only when a second POST to `/api/interactions` arrives ≥4.5s after the first one *by the server's clock* — the client's `dwellMs` alone is never trusted. Fast swipes still upsert the row (card won't repeat in the feed) but earn nothing.
- Read XP is additionally capped per rolling minute (`isReadXpRateLimited` in `src/lib/xp.ts`).
- All XP flows through `awardXp` → one `XpEvent` row per award; the leaderboard, daily ring, and `getXpToday` are all sums over that log. Never mutate `User.xp` directly.
- Timezones: clients send `tzOffsetMinutes` with interactions; SSR reads the `sparklet.tz` cookie. Local calendar days are stored as UTC midnight (`localDayStart` in xp.ts, same convention in streak.ts) — reuse those helpers, don't reinvent day math.

## Layout notes

- Feed composition (unseen pool, due spaced-repetition reviews slotted first, score-weighted shuffle, quiz/guess interleaving) lives in `src/lib/feed.ts` + `src/components/feed/Feed.tsx`; the Feed component also owns view/dwell reporting and the push-reminder soft-ask.
- Scripts under `scripts/` run via tsx and construct their own `PrismaClient` with the pg adapter; app code imports the shared `prisma` from `@/lib/db`.
- Web push is self-hosted (`web-push` + VAPID keys in env; absent keys no-op everywhere). Subscriptions in `PushSubscription`; sender logic in `src/lib/push.ts` + `/api/admin/nudge`.
- `public/sw.js` (offline caching + push handlers) only registers in production builds.
