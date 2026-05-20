-- Rename eth_buy_amount to eth_buy_amount_usd
ALTER TABLE "user_settings" RENAME COLUMN "eth_buy_amount" TO "eth_buy_amount_usd";
ALTER TABLE "user_settings" ALTER COLUMN "eth_buy_amount_usd" TYPE DECIMAL(18,6);
ALTER TABLE "user_settings" ALTER COLUMN "eth_buy_amount_usd" SET DEFAULT 5;
