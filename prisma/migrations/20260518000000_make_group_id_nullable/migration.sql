-- group_id is legacy (bot-in-group mode). MTProto mode uses group_username instead.
-- Drop the NOT NULL constraint so callers can be added without a group_id.
ALTER TABLE "alpha_groups" ALTER COLUMN "group_id" DROP NOT NULL;
