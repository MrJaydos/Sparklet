-- AlterTable
ALTER TABLE "User" ADD COLUMN "friendCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_friendCode_key" ON "User"("friendCode");
