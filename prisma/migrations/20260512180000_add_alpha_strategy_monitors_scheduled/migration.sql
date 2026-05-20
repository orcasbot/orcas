-- Create alpha_groups if it doesn't exist (was originally created outside migration history)
CREATE TABLE IF NOT EXISTS "alpha_groups" (
  "id"              TEXT         NOT NULL,
  "user_id"         TEXT         NOT NULL,
  "group_id"        TEXT,
  "group_title"     TEXT,
  "caller_username" TEXT         NOT NULL,
  "caller_id"       TEXT,
  "is_active"       BOOLEAN      NOT NULL DEFAULT true,
  "trades_executed" INTEGER      NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alpha_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "alpha_groups_user_id_group_id_caller_username_key"
  ON "alpha_groups"("user_id","group_id","caller_username");
CREATE INDEX IF NOT EXISTS "alpha_groups_group_id_is_active_idx" ON "alpha_groups"("group_id","is_active");
CREATE INDEX IF NOT EXISTS "alpha_groups_user_id_idx" ON "alpha_groups"("user_id");

ALTER TABLE "alpha_groups"
  DROP CONSTRAINT IF EXISTS "alpha_groups_user_id_fkey";
ALTER TABLE "alpha_groups"
  ADD CONSTRAINT "alpha_groups_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add alpha_group_id to trades (links auto-buy trades back to their caller)
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "alpha_group_id" TEXT;

-- Add per-caller strategy overrides to alpha_groups
ALTER TABLE "alpha_groups" ADD COLUMN IF NOT EXISTS "buy_amount_usd"  DECIMAL(18,6);
ALTER TABLE "alpha_groups" ADD COLUMN IF NOT EXISTS "take_profit_pct" DECIMAL(5,2);
ALTER TABLE "alpha_groups" ADD COLUMN IF NOT EXISTS "stop_loss_pct"   DECIMAL(5,2);

-- ScheduledActionStatus enum
DO $$ BEGIN
  CREATE TYPE "ScheduledActionStatus" AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- scheduled_actions table
CREATE TABLE IF NOT EXISTS "scheduled_actions" (
  "id"            TEXT                    NOT NULL,
  "user_id"       TEXT                    NOT NULL,
  "action"        TEXT                    NOT NULL,
  "params"        JSONB                   NOT NULL,
  "description"   TEXT,
  "execute_at"    TIMESTAMP(3)            NOT NULL,
  "status"        "ScheduledActionStatus" NOT NULL DEFAULT 'PENDING',
  "result"        JSONB,
  "error_message" TEXT,
  "created_at"    TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executed_at"   TIMESTAMP(3),
  CONSTRAINT "scheduled_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scheduled_actions_status_execute_at_idx" ON "scheduled_actions"("status","execute_at");
CREATE INDEX IF NOT EXISTS "scheduled_actions_user_id_idx"            ON "scheduled_actions"("user_id");

ALTER TABLE "scheduled_actions"
  DROP CONSTRAINT IF EXISTS "scheduled_actions_user_id_fkey";
ALTER TABLE "scheduled_actions"
  ADD CONSTRAINT "scheduled_actions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MonitorType / MonitorStatus enums
DO $$ BEGIN
  CREATE TYPE "MonitorType" AS ENUM ('PRICE_ALERT','LIMIT_ORDER','WALLET_TRACK','DCA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MonitorStatus" AS ENUM ('WATCHING','TRIGGERED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- monitors table
CREATE TABLE IF NOT EXISTS "monitors" (
  "id"              TEXT            NOT NULL,
  "user_id"         TEXT            NOT NULL,
  "type"            "MonitorType"   NOT NULL,
  "status"          "MonitorStatus" NOT NULL DEFAULT 'WATCHING',
  "params"          JSONB           NOT NULL,
  "description"     TEXT,
  "last_checked_at" TIMESTAMP(3),
  "triggered_at"    TIMESTAMP(3),
  "next_run_at"     TIMESTAMP(3),
  "expires_at"      TIMESTAMP(3),
  "created_at"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "monitors_status_last_checked_at_idx" ON "monitors"("status","last_checked_at");
CREATE INDEX IF NOT EXISTS "monitors_user_id_idx"                 ON "monitors"("user_id");

ALTER TABLE "monitors"
  DROP CONSTRAINT IF EXISTS "monitors_user_id_fkey";
ALTER TABLE "monitors"
  ADD CONSTRAINT "monitors_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
