-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "requestedById" TEXT;

-- CreateIndex
CREATE INDEX "Card_requestedById_createdAt_idx" ON "Card"("requestedById", "createdAt");
