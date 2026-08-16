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
  # Repair hallucinated source publishers on rows imported before source
  # normalization. Idempotent and cheap (no model calls) — a no-op once clean.
  tsx scripts/repair-source-attribution.ts \
    || echo "[startup] source attribution repair failed — retries next deploy."
  # Long-form articles for cards that don't have one yet. /card/[id] is
  # noindex and absent from the sitemap until this lands, so this is what
  # grows the indexable surface — capped per run, drains over deploys.
  tsx scripts/generate-articles.ts \
    || echo "[startup] article generation failed — retries next deploy."
) &

exec next start
