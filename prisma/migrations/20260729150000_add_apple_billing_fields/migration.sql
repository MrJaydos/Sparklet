-- AlterTable
ALTER TABLE "User" ADD COLUMN "appleOriginalTransactionId" TEXT,
ADD COLUMN "appleExpiresAt" TIMESTAMP(3),
ADD COLUMN "appleRevoked" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_appleOriginalTransactionId_key" ON "User"("appleOriginalTransactionId");
