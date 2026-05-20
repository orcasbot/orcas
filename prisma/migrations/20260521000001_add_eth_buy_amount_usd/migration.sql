-- Fix all schema mismatches between initial migration and current schema

-- 1. Rename eth_buy_amount -> eth_buy_amount_usd
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='eth_buy_amount') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='eth_buy_amount_usd') THEN
    ALTER TABLE "user_settings" RENAME COLUMN "eth_buy_amount" TO "eth_buy_amount_usd";
    ALTER TABLE "user_settings" ALTER COLUMN "eth_buy_amount_usd" TYPE DECIMAL(18,6);
    ALTER TABLE "user_settings" ALTER COLUMN "eth_buy_amount_usd" SET DEFAULT 5;
  END IF;
END $$;

-- 2. Add alpha_paused if missing
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "alpha_paused" BOOLEAN NOT NULL DEFAULT false;

-- 3. Add low_balance_threshold_usd if missing
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "low_balance_threshold_usd" DECIMAL(18,2) NOT NULL DEFAULT 10;

-- 4. Rename sol_buy_amount -> buy_amount_usd if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='sol_buy_amount') THEN
    ALTER TABLE "user_settings" RENAME COLUMN "sol_buy_amount" TO "buy_amount_usd";
    ALTER TABLE "user_settings" ALTER COLUMN "buy_amount_usd" TYPE DECIMAL(18,6);
    ALTER TABLE "user_settings" ALTER COLUMN "buy_amount_usd" SET DEFAULT 5;
  END IF;
END $$;

-- 5. Drop unused old columns if they exist
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "base_buy_amount";
