-- Full-text search over cards: powers in-feed search and the related-cards
-- trail. Generated column keeps the vector in sync with title/body for free.
ALTER TABLE "Card" ADD COLUMN "search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", ''))) STORED;

CREATE INDEX "Card_search_idx" ON "Card" USING GIN ("search");
