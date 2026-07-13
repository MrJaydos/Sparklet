#!/bin/sh
# Production startup. Only what the app needs to serve requests blocks the
# server: migrations (schema must match the client) and the category seed
# (fast, and the content importer depends on it). The content import —
# minutes of URL re-checks + fact-checking on content commits — runs in the
# background so the site is usable immediately; new cards appear as they
# pass validation.
set -e

prisma migrate deploy
tsx prisma/seed.ts

(
  echo "[startup] content import running in background…"
  if tsx scripts/seed-content.ts; then
    echo "[startup] content import finished."
  else
    echo "[startup] content import failed — unimported content retries on next deploy."
  fi
) &

exec next start
