-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('SOLANA', 'BASE', 'ETHEREUM');

-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('SMART_WALLET', 'EOA', 'CUSTODIAL');

-- CreateEnum
CREATE TYPE "TradeAction" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegram_id" TEXT,
    "telegram_username" TEXT,
    "x_user_id" TEXT,
    "x_username" TEXT,
    "x_display_name" TEXT,
    "x_access_token" TEXT,
    "x_refresh_token" TEXT,
    "x_token_expiry" TIMESTAMP(3),
    "x_connected" BOOLEAN NOT NULL DEFAULT false,
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "premium_until" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "address" TEXT NOT NULL,
    "smart_wallet_address" TEXT,
    "wallet_type" "WalletType" NOT NULL DEFAULT 'SMART_WALLET',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sol_buy_amount" DECIMAL(18,8) NOT NULL DEFAULT 0.1,
    "base_buy_amount" DECIMAL(18,8) NOT NULL DEFAULT 0.005,
    "eth_buy_amount" DECIMAL(18,8) NOT NULL DEFAULT 0.005,
    "max_slippage_bps" INTEGER NOT NULL DEFAULT 500,
    "daily_limit_usd" DECIMAL(18,2) NOT NULL DEFAULT 100,
    "min_liquidity_usd" DECIMAL(18,2) NOT NULL DEFAULT 5000,
    "max_risk_score" INTEGER NOT NULL DEFAULT 60,
    "tg_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "tg_notify_trade_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "tg_notify_trade_failed" BOOLEAN NOT NULL DEFAULT true,
    "tg_notify_trade_rejected" BOOLEAN NOT NULL DEFAULT true,
    "tg_notify_low_balance" BOOLEAN NOT NULL DEFAULT true,
    "auto_sell_enabled" BOOLEAN NOT NULL DEFAULT false,
    "take_profit_pct" DECIMAL(5,2),
    "stop_loss_pct" DECIMAL(5,2),

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT,
    "tweet_id" TEXT NOT NULL,
    "tweet_author" TEXT,
    "tweet_url" TEXT,
    "chain" "Chain" NOT NULL,
    "token_address" TEXT NOT NULL,
    "token_symbol" TEXT,
    "token_name" TEXT,
    "action" "TradeAction" NOT NULL,
    "amount_in" DECIMAL(18,8) NOT NULL,
    "amount_in_usd" DECIMAL(18,2),
    "amount_out" DECIMAL(18,8),
    "amount_out_usd" DECIMAL(18,2),
    "price_per_token" DECIMAL(24,12),
    "slippage_actual" DECIMAL(5,2),
    "tx_hash" TEXT,
    "tx_status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "gas_fee" DECIMAL(18,8),
    "platform_fee" DECIMAL(18,8),
    "risk_score" INTEGER,
    "safety_checks" JSONB,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polling_state" (
    "user_id" TEXT NOT NULL,
    "last_tweet_id" TEXT,
    "last_polled_at" TIMESTAMP(3),
    "poll_errors" INTEGER NOT NULL DEFAULT 0,
    "is_rate_limited" BOOLEAN NOT NULL DEFAULT false,
    "rate_limit_resets_at" TIMESTAMP(3),

    CONSTRAINT "polling_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "token_cache" (
    "address" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "decimals" INTEGER,
    "risk_score" INTEGER,
    "safety_data" JSONB,
    "liquidity_usd" DECIMAL(18,2),
    "is_honeypot" BOOLEAN,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_cache_pkey" PRIMARY KEY ("address","chain")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_x_user_id_key" ON "users"("x_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_chain_key" ON "wallets"("user_id", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");

-- CreateIndex
CREATE INDEX "trades_user_id_created_at_idx" ON "trades"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "trades_token_address_chain_idx" ON "trades"("token_address", "chain");

-- CreateIndex
CREATE INDEX "trades_tx_status_idx" ON "trades"("tx_status");

-- CreateIndex
CREATE INDEX "token_cache_last_checked_at_idx" ON "token_cache"("last_checked_at");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polling_state" ADD CONSTRAINT "polling_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
