-- Collapse any duplicate depth variants left behind by the pre-constraint
-- race in POST /api/cards/[id]/depth, keeping the earliest row per
-- (depthGroupId, depthLevel). Only that race could produce one: nothing
-- else assigns depthGroupId, so imported STANDARD cards each get their own
-- group from the column default. The losers are redundant rewrites of a
-- card that still exists; their child rows cascade.
DELETE FROM "Card" dup
USING "Card" keep
WHERE dup."depthGroupId" IS NOT NULL
  AND dup."depthGroupId" = keep."depthGroupId"
  AND dup."depthLevel"   = keep."depthLevel"
  AND (dup."createdAt", dup.id) > (keep."createdAt", keep.id);

-- CreateIndex
CREATE UNIQUE INDEX "Card_depthGroupId_depthLevel_key" ON "Card"("depthGroupId", "depthLevel");
