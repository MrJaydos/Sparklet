-- CreateTable
CREATE TABLE "MisconceptionCard" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "answer" BOOLEAN NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MisconceptionCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMisconceptionAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "misconceptionCardId" TEXT NOT NULL,
    "guess" BOOLEAN NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMisconceptionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserExplanationAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserExplanationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MisconceptionCard_cardId_idx" ON "MisconceptionCard"("cardId");

-- CreateIndex
CREATE INDEX "UserMisconceptionAttempt_userId_answeredAt_idx" ON "UserMisconceptionAttempt"("userId", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserMisconceptionAttempt_userId_misconceptionCardId_key" ON "UserMisconceptionAttempt"("userId", "misconceptionCardId");

-- CreateIndex
CREATE INDEX "UserExplanationAttempt_userId_answeredAt_idx" ON "UserExplanationAttempt"("userId", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserExplanationAttempt_userId_cardId_key" ON "UserExplanationAttempt"("userId", "cardId");

-- AddForeignKey
ALTER TABLE "MisconceptionCard" ADD CONSTRAINT "MisconceptionCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMisconceptionAttempt" ADD CONSTRAINT "UserMisconceptionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMisconceptionAttempt" ADD CONSTRAINT "UserMisconceptionAttempt_misconceptionCardId_fkey" FOREIGN KEY ("misconceptionCardId") REFERENCES "MisconceptionCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserExplanationAttempt" ADD CONSTRAINT "UserExplanationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserExplanationAttempt" ADD CONSTRAINT "UserExplanationAttempt_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
