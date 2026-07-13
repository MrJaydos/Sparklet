-- CreateEnum
CREATE TYPE "DepthLevel" AS ENUM ('SIMPLE', 'STANDARD', 'DEEP');

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "depthGroupId" TEXT,
ADD COLUMN     "depthLevel" "DepthLevel" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "embedding" JSONB,
ADD COLUMN     "lastValidatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "freezesRefilledAt" TIMESTAMP(3),
ADD COLUMN     "streakFreezesAvailable" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "SpacedRepetitionState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "repetitionCount" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpacedRepetitionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizCard" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserQuizAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quizCardId" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserQuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "folder" TEXT,

    CONSTRAINT "SavedCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInterest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "UserInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpacedRepetitionState_userId_nextReviewAt_idx" ON "SpacedRepetitionState"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpacedRepetitionState_userId_cardId_key" ON "SpacedRepetitionState"("userId", "cardId");

-- CreateIndex
CREATE INDEX "QuizCard_cardId_idx" ON "QuizCard"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "UserQuizAttempt_userId_quizCardId_key" ON "UserQuizAttempt"("userId", "quizCardId");

-- CreateIndex
CREATE INDEX "SavedCard_userId_savedAt_idx" ON "SavedCard"("userId", "savedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedCard_userId_cardId_key" ON "SavedCard"("userId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "UserInterest_userId_categoryId_key" ON "UserInterest"("userId", "categoryId");

-- CreateIndex
CREATE INDEX "Card_depthGroupId_idx" ON "Card"("depthGroupId");

-- AddForeignKey
ALTER TABLE "SpacedRepetitionState" ADD CONSTRAINT "SpacedRepetitionState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpacedRepetitionState" ADD CONSTRAINT "SpacedRepetitionState_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizCard" ADD CONSTRAINT "QuizCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuizAttempt" ADD CONSTRAINT "UserQuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuizAttempt" ADD CONSTRAINT "UserQuizAttempt_quizCardId_fkey" FOREIGN KEY ("quizCardId") REFERENCES "QuizCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedCard" ADD CONSTRAINT "SavedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedCard" ADD CONSTRAINT "SavedCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInterest" ADD CONSTRAINT "UserInterest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
