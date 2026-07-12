# Sparklet — single image serving the Next.js app.
# On start it runs migrations + seeds (idempotent) before serving, so every
# deploy — app change or content-only commit — ends with an up-to-date DB.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["npm", "run", "start:prod"]
