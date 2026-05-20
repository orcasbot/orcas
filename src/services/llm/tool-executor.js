/**
 * Tool executor — maps Claude tool calls to service functions.
 * All tools implemented for Base chain.
 */

const prisma = require('../../lib/prisma');
const priceOracle = require('../price-oracle');
const { checkTokenSafety } = require('../safety/token-safety');
const config = require('../../config');
const logger = require('../../utils/logger');
const { ethers } = require('ethers');

let orchestrator = null;
let walletService = null;
let notifications = null;

function setServices(services) {
  orchestrator = services.orchestrator;
  walletService = services.walletService;
  notifications = services.notifications;
}

async function executeTool(toolName, args, userId) {
  switch (toolName) {
    // ============================================
    // WALLET
    // ============================================
    case 'check_balance': {
      if (args.walletAddress) {
        const baseSwap = require('../swap/base-swap');
        const ethBalance = await baseSwap.getEthBalance(args.walletAddress);
        return { eth: ethBalance, address: args.walletAddress, isExternal: true };
      }
      return walletService.getBalance(userId);
    }

    case 'get_deposit_address': {
      const wallet = await walletService.getOrCreateWallet(userId);
      return { address: wallet.address || wallet };
    }

    case 'withdraw': {
      if (args.tokenAddress) {
        return walletService.sendToken(userId, args.toAddress, args.tokenAddress, args.amount);
      }
      return walletService.sendEth(userId, args.toAddress, args.amount);
    }

    // ============================================
    // PORTFOLIO
    // ============================================
    case 'check_portfolio': {
      const tokens = await orchestrator.getUserTokens(userId);
      const ethPrice = await priceOracle.getEthPrice();

      const enriched = [];
      for (const token of tokens) {
        const price = await priceOracle.getTokenPrice(token.tokenAddress);
        if (price) {
          enriched.push({
            ...token,
            currentPriceUsd: price.usd,
            currentValueUsd: token.totalBought * price.usd,
            priceChange24h: price.priceChange24h,
          });
        }
      }

      return { positions: enriched, ethPrice };
    }

    case 'get_trade_history': {
      const trades = await prisma.trade.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: args.limit || 10,
      });
      return { trades };
    }

    case 'get_trading_stats': {
      const totalTrades = await prisma.trade.count({ where: { userId, txStatus: 'CONFIRMED' } });
      const buys = await prisma.trade.count({ where: { userId, action: 'BUY', txStatus: 'CONFIRMED' } });
      const sells = await prisma.trade.count({ where: { userId, action: 'SELL', txStatus: 'CONFIRMED' } });

      const totalBuyUsd = await prisma.trade.aggregate({
        where: { userId, action: 'BUY', txStatus: 'CONFIRMED' },
        _sum: { amountInUsd: true },
      });
      const totalSellUsd = await prisma.trade.aggregate({
        where: { userId, action: 'SELL', txStatus: 'CONFIRMED' },
        _sum: { amountOutUsd: true },
      });

      return {
        totalTrades,
        buys,
        sells,
        totalBuyUsd: totalBuyUsd._sum.amountInUsd || 0,
        totalSellUsd: totalSellUsd._sum.amountOutUsd || 0,
      };
    }

    // ============================================
    // TRADING
    // ============================================
    case 'buy_token': {
      return orchestrator.executeBuy({
        userId,
        tokenAddress: args.tokenAddress,
        amountUsd: args.amountUsd || 5,
        slippageBps: args.slippageBps,
      });
    }

    case 'sell_token': {
      return orchestrator.executeSell({
        userId,
        tokenAddress: args.tokenAddress,
        percentage: args.percentage || 100,
      });
    }

    case 'swap_tokens': {
      const baseSwap = require('../swap/base-swap');
      const walletData = await walletService.getWalletWithKey(userId);
      if (!walletData) throw new Error('No wallet found');

      const WETH = '0x4200000000000000000000000000000000000006';
      const fromToken = args.fromToken === 'native' ? WETH : args.fromToken;
      const toToken = args.toToken === 'native' ? WETH : args.toToken;

      return baseSwap.executeSwap({
        wallet: { address: walletData.address, privateKey: walletData.privateKey },
        tokenIn: fromToken,
        tokenOut: toToken,
        amountIn: args.amountIn,
        slippageBps: 500,
      });
    }

    // ============================================
    // SETTINGS
    // ============================================
    case 'get_settings': {
      const settings = await prisma.userSettings.findUnique({ where: { userId } });
      return settings || {};
    }

    case 'update_settings': {
      const updateData = {};
      if (args.ethBuyAmountUsd !== undefined) updateData.ethBuyAmountUsd = args.ethBuyAmountUsd;
      if (args.maxSlippageBps !== undefined) updateData.maxSlippageBps = args.maxSlippageBps;
      if (args.maxRiskScore !== undefined) updateData.maxRiskScore = args.maxRiskScore;
      if (args.minLiquidityUsd !== undefined) updateData.minLiquidityUsd = args.minLiquidityUsd;
      if (args.dailyLimitUsd !== undefined) updateData.dailyLimitUsd = args.dailyLimitUsd;
      if (args.takeProfitPct !== undefined) updateData.takeProfitPct = args.takeProfitPct || null;
      if (args.stopLossPct !== undefined) updateData.stopLossPct = args.stopLossPct || null;
      if (args.sniperMaxAgeSecs !== undefined) updateData.sniperMaxAgeSecs = args.sniperMaxAgeSecs;
      if (args.sniperMaxPumpPct !== undefined) updateData.sniperMaxPumpPct = args.sniperMaxPumpPct;

      const settings = await prisma.userSettings.upsert({
        where: { userId },
        update: updateData,
        create: { userId, ...updateData },
      });
      return settings;
    }

    // ============================================
    // TOKEN INFO
    // ============================================
    case 'check_token_safety': {
      return checkTokenSafety(args.tokenAddress);
    }

    case 'get_token_price': {
      if (!args.tokenAddress) {
        const ethPrice = await priceOracle.getEthPrice();
        return { token: 'ETH', usd: ethPrice };
      }
      const price = await priceOracle.getTokenPrice(args.tokenAddress);
      return price || { error: 'Price not found' };
    }

    case 'get_trending_tokens': {
      return priceOracle.getTrendingTokens();
    }

    case 'search_token': {
      return priceOracle.searchToken(args.query);
    }

    case 'get_token_info': {
      const price = await priceOracle.getTokenPrice(args.tokenAddress);
      return price || { error: 'Token not found' };
    }

    // ============================================
    // PREMIUM
    // ============================================
    case 'subscribe_premium': {
      const walletData = await walletService.getWalletWithKey(userId);
      if (!walletData) throw new Error('No wallet found');

      const ethPrice = await priceOracle.getEthPrice();
      const premiumPriceUsd = config.premium.priceUsd;
      const premiumPriceEth = premiumPriceUsd / ethPrice;

      // Check balance
      const baseSwap = require('../swap/base-swap');
      const balance = await baseSwap.getEthBalance(walletData.address);
      if (parseFloat(balance) < premiumPriceEth + 0.001) {
        throw new Error(`Insufficient balance. Need ~${(premiumPriceEth + 0.001).toFixed(6)} ETH for premium ($${premiumPriceUsd})`);
      }

      // Send ETH to treasury
      const treasuryWallet = config.treasury.wallet;
      if (!treasuryWallet) throw new Error('Treasury wallet not configured');

      const provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
      const signer = new ethers.Wallet(walletData.privateKey, provider);
      const tx = await signer.sendTransaction({
        to: treasuryWallet,
        value: ethers.parseEther(premiumPriceEth.toFixed(18)),
      });
      const receipt = await tx.wait();

      // Activate premium for 30 days
      const startDate = new Date();
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await prisma.user.update({
        where: { id: userId },
        data: { isPremium: true, premiumUntil: endDate },
      });

      await prisma.premiumPayment.create({
        data: {
          userId,
          amountPaid: premiumPriceEth,
          amountUsd: premiumPriceUsd,
          txHash: receipt.hash,
          status: 'CONFIRMED',
          startDate,
          endDate,
          confirmedAt: new Date(),
        },
      });

      return {
        success: true,
        txHash: receipt.hash,
        expiresAt: endDate.toISOString(),
        message: `Premium activated! Expires ${endDate.toLocaleDateString()}`,
      };
    }

    case 'check_premium_status': {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true, premiumUntil: true },
      });
      if (!user) return { isPremium: false };

      const isExpired = user.premiumUntil && user.premiumUntil < new Date();
      return {
        isPremium: user.isPremium && !isExpired,
        expiresAt: user.premiumUntil?.toISOString(),
        daysRemaining: user.premiumUntil
          ? Math.max(0, Math.ceil((user.premiumUntil - Date.now()) / 86400000))
          : 0,
      };
    }

    // ============================================
    // TRADING CONTROLS
    // ============================================
    case 'pause_trading': {
      await prisma.userSettings.upsert({
        where: { userId },
        update: { alphaPaused: true },
        create: { userId, alphaPaused: true },
      });
      return { success: true, message: 'Trading paused. Alpha auto-buys and auto-sell are disabled.' };
    }

    case 'resume_trading': {
      await prisma.userSettings.upsert({
        where: { userId },
        update: { alphaPaused: false },
        create: { userId, alphaPaused: false },
      });
      return { success: true, message: 'Trading resumed.' };
    }

    // ============================================
    // ALPHA CALLERS
    // ============================================
    case 'manage_alpha_callers': {
      const { action, callerUsername, groupUsername, groupTitle, buyAmountUsd, takeProfitPct, stopLossPct } = args;

      switch (action) {
        case 'add': {
          if (!callerUsername || !groupUsername) throw new Error('callerUsername and groupUsername required');

          const existing = await prisma.alphaGroup.findFirst({
            where: {
              userId,
              callerUsername: callerUsername.toLowerCase(),
              groupUsername: groupUsername.toLowerCase(),
            },
          });

          if (existing) throw new Error(`Already watching @${callerUsername} in ${groupUsername}`);

          const caller = await prisma.alphaGroup.create({
            data: {
              userId,
              callerUsername: callerUsername.toLowerCase(),
              groupUsername: groupUsername.toLowerCase(),
              groupTitle: groupTitle || groupUsername,
              buyAmountUsd: buyAmountUsd || null,
              takeProfitPct: takeProfitPct || null,
              stopLossPct: stopLossPct || null,
            },
          });

          return { success: true, message: `Added @${callerUsername} in ${groupTitle || groupUsername}`, caller };
        }

        case 'remove': {
          if (!callerUsername) throw new Error('callerUsername required');
          const deleted = await prisma.alphaGroup.deleteMany({
            where: { userId, callerUsername: callerUsername.toLowerCase() },
          });
          return { success: true, message: `Removed @${callerUsername} (${deleted.count} entries)` };
        }

        case 'remove_all': {
          const deleted = await prisma.alphaGroup.deleteMany({ where: { userId } });
          return { success: true, message: `Removed all callers (${deleted.count} entries)` };
        }

        case 'list': {
          const callers = await prisma.alphaGroup.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
          });
          return { callers };
        }

        case 'pause': {
          if (!callerUsername) throw new Error('callerUsername required');
          await prisma.alphaGroup.updateMany({
            where: { userId, callerUsername: callerUsername.toLowerCase() },
            data: { isActive: false },
          });
          return { success: true, message: `Paused @${callerUsername}` };
        }

        case 'resume': {
          if (!callerUsername) throw new Error('callerUsername required');
          await prisma.alphaGroup.updateMany({
            where: { userId, callerUsername: callerUsername.toLowerCase() },
            data: { isActive: true },
          });
          return { success: true, message: `Resumed @${callerUsername}` };
        }

        case 'pause_all': {
          await prisma.alphaGroup.updateMany({
            where: { userId, isActive: true },
            data: { isActive: false },
          });
          return { success: true, message: 'Paused all callers' };
        }

        case 'resume_all': {
          await prisma.alphaGroup.updateMany({
            where: { userId, isActive: false },
            data: { isActive: true },
          });
          return { success: true, message: 'Resumed all callers' };
        }

        case 'update': {
          if (!callerUsername) throw new Error('callerUsername required');
          const updateData = {};
          if (buyAmountUsd !== undefined) updateData.buyAmountUsd = buyAmountUsd || null;
          if (takeProfitPct !== undefined) updateData.takeProfitPct = takeProfitPct || null;
          if (stopLossPct !== undefined) updateData.stopLossPct = stopLossPct || null;

          await prisma.alphaGroup.updateMany({
            where: { userId, callerUsername: callerUsername.toLowerCase() },
            data: updateData,
          });
          return { success: true, message: `Updated @${callerUsername}` };
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    }

    // ============================================
    // MONITORS (Price Alerts, Limit Orders, Wallet Tracker, DCA)
    // ============================================
    case 'set_price_alert': {
      const monitor = await prisma.monitor.create({
        data: {
          userId,
          type: 'PRICE_ALERT',
          params: {
            tokenAddress: args.tokenAddress,
            tokenSymbol: args.tokenSymbol,
            targetPrice: args.targetPrice,
            direction: args.direction,
          },
          description: args.description || `${args.tokenSymbol || 'Token'} price ${args.direction} $${args.targetPrice}`,
        },
      });
      return { success: true, monitorId: monitor.id, message: `Price alert set: ${args.tokenSymbol || 'Token'} ${args.direction} $${args.targetPrice}` };
    }

    case 'set_limit_order': {
      const monitor = await prisma.monitor.create({
        data: {
          userId,
          type: 'LIMIT_ORDER',
          params: {
            tokenAddress: args.tokenAddress,
            tokenSymbol: args.tokenSymbol,
            targetPrice: args.targetPrice,
            direction: args.direction,
            action: args.action,
            amountUsd: args.amountUsd,
            percentage: args.percentage,
          },
          description: args.description || `${args.action} ${args.tokenSymbol || 'Token'} at $${args.targetPrice}`,
        },
      });
      return { success: true, monitorId: monitor.id, message: `Limit order set: ${args.action} ${args.tokenSymbol || 'Token'} at $${args.targetPrice}` };
    }

    case 'set_wallet_tracker': {
      const monitor = await prisma.monitor.create({
        data: {
          userId,
          type: 'WALLET_TRACK',
          params: {
            walletAddress: args.walletAddress,
            mirror: args.mirror || false,
            mirrorAmountUsd: args.mirrorAmountUsd,
          },
          description: args.description || `Tracking ${args.walletAddress.slice(0, 8)}...`,
        },
      });
      return { success: true, monitorId: monitor.id, message: `Wallet tracker set for ${args.walletAddress.slice(0, 10)}...` };
    }

    case 'set_dca': {
      const monitor = await prisma.monitor.create({
        data: {
          userId,
          type: 'DCA',
          params: {
            tokenAddress: args.tokenAddress,
            tokenSymbol: args.tokenSymbol,
            amountUsd: args.amountUsd,
            intervalSeconds: args.intervalSeconds,
            totalExecutions: args.totalExecutions,
            executedCount: 0,
          },
          description: args.description || `DCA $${args.amountUsd} into ${args.tokenSymbol || 'Token'} every ${args.intervalSeconds}s`,
          nextRunAt: new Date(Date.now() + args.intervalSeconds * 1000),
        },
      });
      return { success: true, monitorId: monitor.id, message: `DCA set: $${args.amountUsd} into ${args.tokenSymbol || 'Token'} every ${args.intervalSeconds}s` };
    }

    case 'list_dca': {
      const dcaMonitors = await prisma.monitor.findMany({
        where: { userId, type: 'DCA', status: 'WATCHING' },
        orderBy: { createdAt: 'desc' },
      });
      return { dcaPlans: dcaMonitors };
    }

    case 'list_monitors': {
      const monitors = await prisma.monitor.findMany({
        where: { userId, status: 'WATCHING' },
        orderBy: { createdAt: 'desc' },
      });
      return { monitors };
    }

    case 'cancel_monitor': {
      const monitor = await prisma.monitor.findFirst({
        where: { id: args.monitorId, userId },
      });
      if (!monitor) throw new Error('Monitor not found');

      await prisma.monitor.update({
        where: { id: args.monitorId },
        data: { status: 'CANCELLED' },
      });
      return { success: true, message: 'Monitor cancelled' };
    }

    // ============================================
    // SCHEDULED ACTIONS
    // ============================================
    case 'schedule_action': {
      const scheduled = await prisma.scheduledAction.create({
        data: {
          userId,
          action: args.action,
          params: args.params,
          description: args.description,
          executeAt: new Date(args.executeAt),
        },
      });
      return { success: true, scheduledId: scheduled.id, message: `Scheduled: ${args.description} at ${args.executeAt}` };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

module.exports = { executeTool, setServices };
