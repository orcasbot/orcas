require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/, 'PORT must be a number'),
  API_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  BASE_RPC_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(64, 'ENCRYPTION_KEY must be 64-char hex (32 bytes)'),
  // Optional
  TREASURY_WALLET: z.string().optional(),
  ZEROX_API_KEY: z.string().optional(),
  ONEINCH_API_KEY: z.string().optional(),
  GOPLUS_API_URL: z.string().optional(),
  ERROR_REPORT_BOT_TOKEN: z.string().optional(),
  ERROR_REPORT_CHAT_ID: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  const missing = envResult.error.issues.map(
    i => `  ${i.path.join('.')}: ${i.message}`
  );
  console.error(
    `\n❌ Invalid environment configuration:\n${missing.join('\n')}\n\n` +
    `Check your .env file against .env.example\n`
  );
  process.exit(1);
}

const optionalWarnings = [];
if (!process.env.TREASURY_WALLET) optionalWarnings.push('TREASURY_WALLET (platform fees will not be collected)');
if (!process.env.ZEROX_API_KEY) optionalWarnings.push('ZEROX_API_KEY (0x API may rate-limit)');
if (!process.env.ERROR_REPORT_BOT_TOKEN || !process.env.ERROR_REPORT_CHAT_ID) optionalWarnings.push('ERROR_REPORT_BOT_TOKEN / ERROR_REPORT_CHAT_ID (Error notifications disabled)');

if (optionalWarnings.length > 0) {
  console.warn(`⚠️  Missing optional env vars:\n  ${optionalWarnings.join('\n  ')}\n`);
}

const config = {
  env: process.env.NODE_ENV,
  port: parseInt(process.env.PORT),
  apiUrl: process.env.API_URL,
  frontendUrl: process.env.FRONTEND_URL,

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN,
  },

  base: {
    rpcUrl: process.env.BASE_RPC_URL,
    chainId: 8453,
    explorerUrl: 'https://basescan.org',
    explorerTxUrl: 'https://basescan.org/tx',
    explorerAddressUrl: 'https://basescan.org/address',
  },

  encryptionKey: process.env.ENCRYPTION_KEY,

  swap: {
    // 0x Protocol — primary DEX aggregator for Base
    zerox: {
      apiUrl: 'https://base.api.0x.org',
      apiKey: process.env.ZEROX_API_KEY,
    },
    // 1inch — fallback aggregator
    oneinch: {
      apiUrl: 'https://api.1inch.dev',
      apiKey: process.env.ONEINCH_API_KEY,
    },
    // Uniswap V3 — direct pool quotes
    uniswap: {
      routerAddress: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3 SwapRouter02 on Base
      quoterAddress: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', // Uniswap V3 QuoterV2 on Base
    },
  },

  safety: {
    goplusUrl: process.env.GOPLUS_API_URL || 'https://api.gopluslabs.io/api/v1',
    dexscreenerUrl: 'https://api.dexscreener.com',
  },

  premium: {
    priceUsd: parseFloat(process.env.PREMIUM_PRICE_USD || '10'),
  },

  trade: {
    defaultSlippageBps: parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '500'),
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '1500'),
    platformFeeBps: parseInt(process.env.PLATFORM_FEE_BPS || '200'),
  },

  treasury: {
    wallet: process.env.TREASURY_WALLET,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    errorBotToken: process.env.ERROR_REPORT_BOT_TOKEN,
    errorChatId: process.env.ERROR_REPORT_CHAT_ID,
    botUsername: process.env.TELEGRAM_BOT_USERNAME || 'OrcasBot',
  },

  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1024'),
  },

  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === 'true',
};

module.exports = config;
