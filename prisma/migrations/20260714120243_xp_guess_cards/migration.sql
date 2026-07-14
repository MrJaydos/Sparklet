-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "enrichedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GuessCard" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "answer" DOUBLE PRECISION NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuessCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGuessAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guessCardId" TEXT NOT NULL,
    "guess" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGuessAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuessCard_cardId_idx" ON "GuessCard"("cardId");

-- CreateIndex
CREATE INDEX "UserGuessAttempt_userId_answeredAt_idx" ON "UserGuessAttempt"("userId", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserGuessAttempt_userId_guessCardId_key" ON "UserGuessAttempt"("userId", "guessCardId");

-- CreateIndex
CREATE INDEX "XpEvent_userId_createdAt_idx" ON "XpEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserQuizAttempt_userId_answeredAt_idx" ON "UserQuizAttempt"("userId", "answeredAt");

-- AddForeignKey
ALTER TABLE "GuessCard" ADD CONSTRAINT "GuessCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGuessAttempt" ADD CONSTRAINT "UserGuessAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGuessAttempt" ADD CONSTRAINT "UserGuessAttempt_guessCardId_fkey" FOREIGN KEY ("guessCardId") REFERENCES "GuessCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
