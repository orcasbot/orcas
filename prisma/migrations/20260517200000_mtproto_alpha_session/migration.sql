-- Add group_username to alpha_groups (MTProto mode — track by @handle instead of bot group ID)
ALTER TABLE "alpha_groups" ADD COLUMN IF NOT EXISTS "group_username" TEXT;

-- Drop old unique constraint (was userId+groupId+callerUsername)
ALTER TABLE "alpha_groups"
  DROP CONSTRAINT IF EXISTS "alpha_groups_user_id_group_id_caller_username_key";

-- New unique constraint: userId + callerUsername + groupUsername (groupId no longer required)
CREATE UNIQUE INDEX IF NOT EXISTS "alpha_groups_user_id_caller_username_group_username_key"
  ON "alpha_groups"("user_id", "caller_username", "group_username");

-- user_telegram_sessions: stores MTProto session per user
CREATE TABLE IF NOT EXISTS "user_telegram_sessions" (
  "id"             TEXT         NOT NULL,
  "user_id"        TEXT         NOT NULL,
  "session_string" TEXT         NOT NULL,
  "phone"          TEXT,
  "connected_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_telegram_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_telegram_sessions_user_id_key"
  ON "user_telegram_sessions"("user_id");

ALTER TABLE "user_telegram_sessions"
  DROP CONSTRAINT IF EXISTS "user_telegram_sessions_user_id_fkey";
ALTER TABLE "user_telegram_sessions"
  ADD CONSTRAINT "user_telegram_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
