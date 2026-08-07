# Sparklet — single image serving the Next.js app.
# On start it runs migrations + category seed before serving; the (slow,
# idempotent) content import runs in the background after the server is up,
# so the site is usable while new cards are still being validated.
#
# Two stages, but not the usual `output: "standalone"` shape: start-prod.sh
# runs real tsx scripts at boot (prisma/seed.ts, seed-content.ts,
# enrich-cards.ts), and standalone only traces what the Next server itself
# imports — it would drop the scripts' own dependency graph and break
# startup. So the runtime stage keeps the same file layout the scripts
# expect, and the split exists to leave devDependencies behind rather than
# to slim the tree by tracing it.

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at container runtime — unlike every other env var here, Coolify's
# usual runtime injection doesn't reach them. They must come in as Docker
# build args (Coolify: mark them "available at buildtime" so it passes
# --build-arg for these). Empty default preserves "unset = feature off".
ARG NEXT_PUBLIC_ADSENSE_CLIENT_ID=""
ARG NEXT_PUBLIC_ADSENSE_SLOT_ID=""
ENV NEXT_PUBLIC_ADSENSE_CLIENT_ID=$NEXT_PUBLIC_ADSENSE_CLIENT_ID
ENV NEXT_PUBLIC_ADSENSE_SLOT_ID=$NEXT_PUBLIC_ADSENSE_SLOT_ID

# Build-only dummy values: nothing connects to a DB during `next build`, and
# real values are injected by Coolify at runtime.
RUN npx prisma generate && \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-only-not-a-secret" \
    NEXT_TELEMETRY_DISABLED=1 \
    npm run build

# eslint, typescript, tailwind and the @types packages have no job past this
# line. `prisma` and `tsx` are real dependencies (start-prod.sh shells out to
# both), so they survive the prune.
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime

WORKDIR /app

# Owned by the unprivileged `node` user that ships with the base image, so
# the app can still write .next/cache at runtime without the whole process
# running as root.
COPY --from=build --chown=node:node /app /app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["npm", "run", "start:prod"]
