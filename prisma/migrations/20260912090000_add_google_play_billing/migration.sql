-- Google Play billing, mirroring the Apple IAP columns added alongside it.
-- Purely additive and nullable (plus one defaulted boolean), so this is safe
-- to apply to a live database ahead of any Play Console setup existing: with
-- no rows populated, isPremiumViaGooglePlay() is false for everyone and the
-- other two billing rails are unaffected.
ALTER TABLE "User" ADD COLUMN "googlePurchaseToken" TEXT;
ALTER TABLE "User" ADD COLUMN "googleExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "googleRevoked" BOOLEAN NOT NULL DEFAULT false;

-- One Play subscription unlocks one account; the constraint is the actual
-- enforcement, not the application check (see applyGooglePurchase).
CREATE UNIQUE INDEX "User_googlePurchaseToken_key" ON "User"("googlePurchaseToken");
