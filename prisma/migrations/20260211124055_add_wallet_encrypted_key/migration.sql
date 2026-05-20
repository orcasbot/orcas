-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "encrypted_key" TEXT,
ALTER COLUMN "wallet_type" SET DEFAULT 'EOA';
