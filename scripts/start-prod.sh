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
  # Quizzes + guess challenges for cards that predate them.
  tsx scripts/enrich-cards.ts \
    || echo "[startup] card enrichment failed — retries next deploy."
  # Narration for any cards missing cached audio (new imports included).
  tsx scripts/pregen-audio.ts \
    || echo "[startup] audio pre-generation failed — cards fall back to lazy narration."
) &

exec next start
