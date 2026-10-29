-- Add entityId to Order table
-- Nullable so existing orders without entity are not affected.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
