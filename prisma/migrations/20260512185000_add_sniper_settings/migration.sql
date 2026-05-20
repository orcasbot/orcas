ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "sniper_max_age_secs" INTEGER;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "sniper_max_pump_pct" DECIMAL(6,2);
