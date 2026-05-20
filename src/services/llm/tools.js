/**
 * Claude tool definitions — Base chain only.
 */

const ALL_TOOLS = [
  {
    name: 'check_balance',
    description: 'Get wallet balances. If walletAddress is provided, fetches that public address balance. Without walletAddress, returns the user\'s own balances: { eth, tokens: [ERC-20 balances], totalUsd }.',
    input_schema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'Optional external wallet address to check.',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_portfolio',
    description: 'Get the user\'s active token positions with current value, P&L, and trade history.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'buy_token',
    description: 'Buy a token by its contract address. Amount is in USD. System converts to ETH automatically.',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'The token contract address (0x...) to buy',
        },
        amountUsd: {
          type: 'number',
          description: 'Amount in USD to spend. Minimum $2.',
        },
        slippageBps: {
          type: 'number',
          description: 'Slippage tolerance in basis points (e.g., 500 = 5%). Optional.',
        },
      },
      required: ['tokenAddress'],
    },
  },
  {
    name: 'sell_token',
    description: 'Sell a token the user holds. Always use the exact token address from check_portfolio. Can sell by percentage or sell all.',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'Exact token contract address to sell.',
        },
        percentage: {
          type: 'number',
          description: 'Percentage of holdings to sell (1-100). Omit to sell all.',
        },
      },
      required: ['tokenAddress'],
    },
  },
  {
    name: 'swap_tokens',
    description: 'Swap one token for another (e.g., ETH to USDC, or token-to-token).',
    input_schema: {
      type: 'object',
      properties: {
        fromToken: {
          type: 'string',
          description: 'Token address to sell (use "native" for ETH)',
        },
        toToken: {
          type: 'string',
          description: 'Token address to buy (use "native" for ETH)',
        },
        amountIn: {
          type: 'string',
          description: 'Amount of fromToken to sell (in human-readable units)',
        },
        sellAll: {
          type: 'boolean',
          description: 'If true, sell entire balance of fromToken',
        },
      },
      required: ['fromToken', 'toToken'],
    },
  },
  {
    name: 'get_trade_history',
    description: 'Get the user\'s recent trade history.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of trades to return (default: 10, max: 50)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_trading_stats',
    description: 'Get trading statistics: total trades, win rate, total P&L.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_settings',
    description: 'Get current trading settings.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_settings',
    description: 'Update trading settings. Only include fields explicitly mentioned.',
    input_schema: {
      type: 'object',
      properties: {
        ethBuyAmountUsd: { type: 'number', description: 'Default buy amount in USD' },
        maxSlippageBps: { type: 'number', description: 'Max slippage in bps (100-5000)' },
        maxRiskScore: { type: 'number', description: 'Max token risk score (0-100)' },
        minLiquidityUsd: { type: 'number', description: 'Min token liquidity in USD' },
        dailyLimitUsd: { type: 'number', description: 'Daily spending limit USD' },
        takeProfitPct: { type: 'number', description: 'Take profit %. Set 0 to disable.' },
        stopLossPct: { type: 'number', description: 'Stop loss %. Set 0 to disable.' },
      },
      required: [],
    },
  },
  {
    name: 'check_token_safety',
    description: 'Check token safety/risk score. Returns honeypot detection, liquidity check, rug pull indicators.',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'Token contract address to check',
        },
      },
      required: ['tokenAddress'],
    },
  },
  {
    name: 'get_token_price',
    description: 'Get current price of a token or ETH. For ETH price, omit tokenAddress.',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'Token contract address. Omit for ETH price.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_trending_tokens',
    description: 'Get trending tokens on Base from DEXScreener.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_token',
    description: 'Search for a token by name or symbol (e.g., "BRETT", "DEGEN"). Returns matching tokens with addresses and prices.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Token name or symbol to search for',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_token_info',
    description: 'Get detailed token info: market cap, volume, liquidity, price change, pair age.',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'Token contract address',
        },
      },
      required: ['tokenAddress'],
    },
  },
  {
    name: 'subscribe_premium',
    description: 'Subscribe to premium ($10/month in ETH).',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'check_premium_status',
    description: 'Check premium subscription status.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'pause_trading',
    description: 'Pause all automatic trading.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'resume_trading',
    description: 'Resume automatic trading.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_deposit_address',
    description: 'Get the user\'s wallet deposit address for Base.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'withdraw',
    description: 'Withdraw ETH or ERC-20 tokens to an external address. Always confirm before executing.',
    input_schema: {
      type: 'object',
      properties: {
        toAddress: {
          type: 'string',
          description: 'Destination wallet address',
        },
        amount: {
          type: 'number',
          description: 'Amount to withdraw (in human-readable units)',
        },
        tokenAddress: {
          type: 'string',
          description: 'Token address for ERC-20. Omit for native ETH.',
        },
      },
      required: ['toAddress', 'amount'],
    },
  },
  {
    name: 'manage_alpha_callers',
    description: 'Add, remove, list, pause, or resume alpha callers.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'list', 'pause', 'resume', 'pause_all', 'resume_all', 'update'],
        },
        callerUsername: { type: 'string', description: 'TG username of caller (without @)' },
        groupUsername: { type: 'string', description: 'Group/channel identifier' },
        groupTitle: { type: 'string' },
        buyAmountUsd: { type: 'number' },
        takeProfitPct: { type: 'number' },
        stopLossPct: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'schedule_action',
    description: 'Schedule an action for later execution.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Tool name to execute' },
        params: { type: 'object' },
        executeAt: { type: 'string', description: 'ISO 8601 datetime' },
        description: { type: 'string' },
      },
      required: ['action', 'params', 'executeAt', 'description'],
    },
  },
  {
    name: 'set_price_alert',
    description: 'Notify when token price crosses threshold.',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: { type: 'string' },
        tokenSymbol: { type: 'string' },
        targetPrice: { type: 'number' },
        direction: { type: 'string', enum: ['above', 'below'] },
        description: { type: 'string' },
      },
      required: ['tokenAddress', 'targetPrice', 'direction'],
    },
  },
  {
    name: 'set_limit_order',
    description: 'Buy/sell automatically when token hits target price.',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: { type: 'string' },
        tokenSymbol: { type: 'string' },
        targetPrice: { type: 'number' },
        direction: { type: 'string', enum: ['above', 'below'] },
        action: { type: 'string', enum: ['buy', 'sell'] },
        amountUsd: { type: 'number' },
        percentage: { type: 'number' },
        description: { type: 'string' },
      },
      required: ['tokenAddress', 'targetPrice', 'direction', 'action'],
    },
  },
  {
    name: 'set_wallet_tracker',
    description: 'Track a wallet address and optionally mirror their trades automatically.',
    input_schema: {
      type: 'object',
      properties: {
        walletAddress: {
          type: 'string',
          description: 'The wallet address to track on Base chain',
        },
        mirror: {
          type: 'boolean',
          description: 'Whether to automatically copy/mirror their trades',
        },
        mirrorAmountUsd: {
          type: 'number',
          description: 'USD amount per mirror trade (defaults to your buy amount setting)',
        },
        description: {
          type: 'string',
          description: 'Custom note (e.g. "Whale #1", "Alpha caller @username")',
        },
      },
      required: ['walletAddress', 'mirror'],
    },
  },
  {
    name: 'list_monitors',
    description: 'List active price alerts, limit orders, and wallet trackers.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancel_monitor',
    description: 'Cancel a specific monitor/alert by ID.',
    input_schema: {
      type: 'object',
      properties: {
        monitorId: { type: 'string', description: 'Monitor ID from list_monitors' },
      },
      required: ['monitorId'],
    },
  },
  {
    name: 'set_dca',
    description: 'Set up a DCA (Dollar-Cost Averaging) plan to automatically buy a token at regular intervals',
    input_schema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'Token contract address to DCA into',
        },
        tokenSymbol: {
          type: 'string',
          description: 'Token symbol (e.g. BRETT, DEGEN)',
        },
        amountUsd: {
          type: 'number',
          description: 'Amount in USD to buy each interval',
        },
        intervalSeconds: {
          type: 'number',
          description: 'Time between buys in seconds (e.g. 3600 for hourly, 86400 for daily)',
        },
        totalExecutions: {
          type: 'number',
          description: 'Total number of buys to execute',
        },
        description: {
          type: 'string',
          description: 'Custom note for this DCA plan',
        },
      },
      required: ['tokenAddress', 'tokenSymbol', 'amountUsd', 'intervalSeconds', 'totalExecutions'],
    },
  },
  {
    name: 'list_dca',
    description: 'List all active DCA (Dollar-Cost Averaging) plans',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

module.exports = { ALL_TOOLS };
