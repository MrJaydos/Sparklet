-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'INCLUDED', 'DISMISSED');

-- CreateTable
CREATE TABLE "CardSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "includedAt" TIMESTAMP(3),

    CONSTRAINT "CardSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardSuggestion_status_categoryId_createdAt_idx" ON "CardSuggestion"("status", "categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "CardSuggestion_userId_createdAt_idx" ON "CardSuggestion"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CardSuggestion" ADD CONSTRAINT "CardSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardSuggestion" ADD CONSTRAINT "CardSuggestion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
