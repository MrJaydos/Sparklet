-- Long-form companion article for /card/[id]. The feed keeps swiping the
-- ~60-word body; this is what makes the page itself worth indexing. Cards
-- without one serve noindex and stay out of the sitemap (ARTICLE_MIN_WORDS
-- in src/lib/article.ts), so backfilling this column is what grows the
-- indexable surface.
-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "article" JSONB,
ADD COLUMN     "articleAt" TIMESTAMP(3),
ADD COLUMN     "articleWords" INTEGER;

-- Drives the deploy-time backfill's "what's left to do" scan.
-- CreateIndex
CREATE INDEX "Card_articleAt_idx" ON "Card"("articleAt");
