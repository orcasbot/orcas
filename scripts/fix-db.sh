#!/bin/sh
# Fix missing columns in user_settings table
psql "$DATABASE_URL" -c "
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS eth_buy_amount_usd DECIMAL(18,6) NOT NULL DEFAULT 5;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS alpha_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS low_balance_threshold_usd DECIMAL(18,2) NOT NULL DEFAULT 10;
" 2>/dev/null || true
