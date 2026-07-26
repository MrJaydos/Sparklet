-- CreateTable
CREATE TABLE "OAuthStateBackup" (
    "state" TEXT NOT NULL,
    "cookies" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthStateBackup_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX "OAuthStateBackup_expiresAt_idx" ON "OAuthStateBackup"("expiresAt");
