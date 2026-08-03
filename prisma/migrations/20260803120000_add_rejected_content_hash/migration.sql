-- CreateTable
CREATE TABLE "RejectedContentHash" (
    "contentHash" TEXT NOT NULL,
    "reason" TEXT,
    "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedContentHash_pkey" PRIMARY KEY ("contentHash")
);
