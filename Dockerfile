# Sparklet — single image serving the Next.js app.
# On start it runs migrations + category seed before serving; the (slow,
# idempotent) content import runs in the background after the server is up,
# so the site is usable while new cards are still being validated.
FROM node:22-alpine

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

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["npm", "run", "start:prod"]
