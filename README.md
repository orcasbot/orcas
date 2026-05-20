# 🐋 Orcas

**Base chain meme coin trading bot on Telegram, powered by Claude AI.**

Trade naturally: "buy $10 of BRETT", "sell 50% of DEGEN", "what's trending on Base?"

📖 **Try the bot:** @OrcasBot on Telegram

---

## How It Works

1. **Message the bot** on Telegram — every message goes through Claude AI
2. **Trade naturally** — buy, sell, swap any token on Base by pasting a CA
3. **Alpha callers** — track callers in Telegram groups, auto-buy when they post CAs
4. **Auto-sell** — set TP/SL triggers, Orcas executes automatically
5. **Price alerts** — get notified when a token hits your target price
6. **Limit orders** — auto-buy/sell when price crosses a threshold
7. **DCA** — dollar-cost average into positions on a schedule
8. **Wallet tracker** — watch whale wallets, optionally mirror their trades

## Architecture

```
User TG message → Grammy bot → Rate limit → Claude AI (system prompt + 25 tools)
  → Claude returns tool_use → Tool executor → Services → Response back to TG
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Bot Framework | Grammy (Telegram) |
| AI Engine | Claude (Anthropic) — conversational trading with tool use |
| Blockchain | Base (chainId 8453) via ethers.js v6 |
| DEX Aggregation | 0x Protocol (primary) + 1inch (fallback) |
| Price Data | DEXScreener + CoinGecko |
| Token Safety | GoPlus Security API |
| Database | PostgreSQL (Neon) + Prisma ORM |
| Cache | Upstash Redis |
| Real-time | Socket.IO |

### Project Structure

```
src/
├── index.js                         # Express + Socket.IO + Telegram bot startup
├── config/index.js                  # Base chain config, API keys, trade params
├── bot/
│   └── index.js                     # Grammy bot — routes messages through Claude
│   └── handlers/
│       └── alpha.js                 # Alpha caller auto-buy on CA detection
├── services/
│   ├── llm/
│   │   ├── claude-client.js         # Claude API with tool-use loops
│   │   ├── tools.js                 # 25 tool definitions
│   │   ├── tool-executor.js         # Maps tool calls → service functions
│   │   ├── system-prompt.js         # Orcas personality + rules
│   │   ├── conversation-manager.js  # Redis-backed chat history
│   │   └── rate-limiter.js          # Per-user rate limits
│   ├── swap/
│   │   └── base-swap.js             # 0x + 1inch DEX aggregation on Base
│   ├── wallet/
│   │   └── wallet-service.js        # ethers.js wallet gen, AES-256 encrypted keys
│   ├── safety/
│   │   └── token-safety.js          # GoPlus honeypot/rug detection
│   ├── trade-orchestrator.js        # Buy/sell execution flow
│   ├── price-oracle.js              # DEXScreener + CoinGecko prices
│   ├── notifications.js             # Telegram trade notifications
│   ├── auto-sell.js                 # TP/SL auto-sell monitor
│   ├── deposit-monitor.js           # Incoming deposit detection
│   ├── monitor-runner.js            # Price alerts, limit orders, DCA, wallet tracker
│   ├── premium-expiry.js            # Premium subscription expiry checker
│   └── ca-parser.js                 # Contract address extraction from text
├── routes/
│   ├── auth.js                      # Telegram auth + JWT
│   ├── trades.js                    # Trade history API
│   ├── settings.js                  # User settings CRUD
│   ├── wallet.js                    # Wallet address + balance
│   └── admin.js                     # Admin stats
├── middleware/
│   └── rate-limiter.js              # Express rate limiting
├── lib/
│   ├── prisma.js                    # Database client
│   └── redis.js                     # Redis client (Upstash)
└── utils/
    └── logger.js                    # Winston logging
```

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database (Neon, Supabase, or local)
- Telegram Bot Token (from @BotFather)
- Anthropic API Key
- Base RPC URL (Alchemy, Infura, or public)

### Quick Start

```bash
# Clone and install
git clone <your-repo-url> orcas
cd orcas
npm install

# Configure environment
cp .env.example .env
# Edit .env with your keys

# Setup database
npx prisma migrate dev --name init

# Start development server
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Server port (e.g., 3000) |
| `API_URL` | Yes | Server URL (e.g., http://localhost:3000) |
| `FRONTEND_URL` | Yes | Frontend URL |
| `JWT_SECRET` | Yes | Auth token secret (min 16 chars) |
| `JWT_EXPIRES_IN` | Yes | Token expiry (e.g., 7d) |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `BASE_RPC_URL` | Yes | Base mainnet RPC URL |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DIRECT_DATABASE_URL` | Yes | Direct DB connection (for migrations) |
| `ENCRYPTION_KEY` | Yes | 64-char hex key for wallet encryption |
| `TREASURY_WALLET` | No | Wallet address for 2% platform fees |
| `ZEROX_API_KEY` | No | 0x Protocol API key |
| `ONEINCH_API_KEY` | No | 1inch API key |
| `UPSTASH_REDIS_REST_URL` | No | Redis URL for caching |
| `UPSTASH_REDIS_REST_TOKEN` | No | Redis auth token |
| `ERROR_REPORT_BOT_TOKEN` | No | Error notification bot token |
| `ERROR_REPORT_CHAT_ID` | No | Error notification chat ID |

## Features

### Trading

- **Buy** — paste a contract address, specify USD amount, Orcas handles the rest
- **Sell** — sell by percentage or full amount
- **Swap** — token-to-token swaps via DEX aggregation
- **Safety check** — GoPlus risk scoring before every trade (honeypot, rug, mint, etc.)

### Alpha Callers

Track specific callers in Telegram groups. When they post a contract address, Orcas auto-buys for you.

```
"watch @whaletrader in @alphagroup" → adds alpha caller
"pause @whaletrader" → temporarily stops
"remove @whaletrader" → permanently deletes
```

### Auto-Sell (TP/SL)

Set take-profit and stop-loss percentages. Orcas monitors your positions and sells automatically.

```
"set TP 100%, SL 50%" → sell at 2x or -50%
"disable TP" → turn off take-profit
```

### Price Alerts & Limit Orders

Get notified or auto-execute when tokens hit target prices.

```
"alert me when BRETT hits $0.01" → price notification
"buy $50 of DEGEN at $0.0002" → limit buy order
```

### DCA (Dollar-Cost Averaging)

Automatically buy tokens on a schedule.

```
"DCA $10 into BRETT every hour for 24 hours"
```

### Wallet Tracker

Watch external wallets and optionally mirror their trades.

```
"track wallet 0x123..." → watch for activity
"mirror 0x123... with $20 per trade" → auto-copy trades
```

## Fees

| Action | Fee |
|--------|-----|
| Buy | No platform fee |
| Sell | 2% of ETH received |
| Gas | ~$0.01-0.05 per tx (Base is cheap) |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/telegram | Login via Telegram |
| GET | /api/auth/me | Get current user |
| GET | /api/trades | Trade history |
| GET | /api/trades/stats | Trading statistics |
| GET | /api/settings | Get user settings |
| PUT | /api/settings | Update settings |
| GET | /api/wallet | Get wallet address |
| GET | /api/wallet/balance | Get ETH balance |
| GET | /health | Health check |

## Development

```bash
npm run dev          # Start with nodemon (auto-reload)
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run migrations
npm run db:push      # Push schema changes
npm run db:studio    # Open Prisma Studio
npm run test         # Run tests
```

## Deployment

### Railway / Render / Fly.io

1. Connect your GitHub repo
2. Set environment variables
3. Deploy — it runs `npm start` by default

### Docker (coming soon)

## License

MIT

---

Built with 🐋 for the Base chain degen community.
