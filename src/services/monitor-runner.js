/**
 * Monitor runner — processes PRICE_ALERT, LIMIT_ORDER, WALLET_TRACK, and DCA monitors.
 * Polls every 30s, checks Monitor table, triggers actions when conditions are met.
 */

const { ethers } = require('ethers');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const config = require('../config');
const priceOracle = require('./price-oracle');

const POLL_INTERVAL_MS = 30_000;

class MonitorRunner {
  constructor(tradeOrchestrator, notificationService) {
    this.tradeOrchestrator = tradeOrchestrator;
    this.notificationService = notificationService;
    this.intervalId = null;
    this.running = false;
  }

  start() {
    if (this.running) return Promise.resolve();
    this.running = true;
    logger.info('MonitorRunner started');
    this.intervalId = setInterval(() => this._tick().catch(err => {
      logger.error('MonitorRunner tick error', { error: err.message });
    }), POLL_INTERVAL_MS);
    return Promise.resolve();
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.running = false;
    logger.info('MonitorRunner stopped');
  }

  async _tick() {
    const now = new Date();

    // Fetch all active monitors
    const monitors = await prisma.monitor.findMany({
      where: { status: 'WATCHING' },
      include: { user: { select: { id: true, telegramId: true } } },
    });

    for (const monitor of monitors) {
      // Skip expired monitors
      if (monitor.expiresAt && new Date(monitor.expiresAt) < now) {
        await prisma.monitor.update({
          where: { id: monitor.id },
          data: { status: 'CANCELLED' },
        });
        continue;
      }

      // Skip if nextRunAt is in the future (for DCA)
      if (monitor.nextRunAt && new Date(monitor.nextRunAt) > now) continue;

      try {
        switch (monitor.type) {
          case 'PRICE_ALERT':
            await this._checkPriceAlert(monitor);
            break;
          case 'LIMIT_ORDER':
            await this._checkLimitOrder(monitor);
            break;
          case 'WALLET_TRACK':
            await this._checkWalletTrack(monitor);
            break;
          case 'DCA':
            await this._checkDca(monitor);
            break;
        }

        await prisma.monitor.update({
          where: { id: monitor.id },
          data: { lastCheckedAt: now },
        });
      } catch (err) {
        logger.error('MonitorRunner check failed', { monitorId: monitor.id, type: monitor.type, error: err.message });
      }
    }
  }

  // ── PRICE_ALERT ──────────────────────────────────────────────────────
  async _checkPriceAlert(monitor) {
    const params = typeof monitor.params === 'string' ? JSON.parse(monitor.params) : monitor.params;
    const { tokenAddress, condition, targetPriceUsd } = params;
    // condition: 'above' | 'below'

    const priceData = await priceOracle.getTokenPrice(tokenAddress);
    if (!priceData || !priceData.usd) return;

    const currentPrice = priceData.usd;
    const triggered = condition === 'above'
      ? currentPrice >= targetPriceUsd
      : currentPrice <= targetPriceUsd;

    if (triggered) {
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { status: 'TRIGGERED', triggeredAt: new Date() },
      });

      await this._notify(monitor.user.telegramId, monitor.userId,
        `🔔 *Price Alert*\n\n` +
        `Token: ${tokenAddress}\n` +
        `Current: $${currentPrice.toFixed(8)}\n` +
        `Target: ${condition} $${targetPriceUsd}\n\n` +
        `View: ${config.base.explorerAddressUrl}/${tokenAddress}`
      );
    }
  }

  // ── LIMIT_ORDER (buy or sell at target price) ────────────────────────
  async _checkLimitOrder(monitor) {
    const params = typeof monitor.params === 'string' ? JSON.parse(monitor.params) : monitor.params;
    const { tokenAddress, side, targetPriceUsd, amountUsd, percentage } = params;
    // side: 'buy' | 'sell'

    const priceData = await priceOracle.getTokenPrice(tokenAddress);
    if (!priceData || !priceData.usd) return;

    const currentPrice = priceData.usd;
    const triggered = side === 'buy'
      ? currentPrice <= targetPriceUsd
      : currentPrice >= targetPriceUsd;

    if (!triggered) return;

    try {
      let result;
      if (side === 'buy') {
        result = await this.tradeOrchestrator.executeBuy({
          userId: monitor.userId,
          tokenAddress,
          amountUsd: amountUsd || 5,
          slippageBps: config.trade.defaultSlippageBps,
        });
      } else {
        result = await this.tradeOrchestrator.executeSell({
          userId: monitor.userId,
          tokenAddress,
          percentage: percentage || 100,
        });
      }

      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { status: 'TRIGGERED', triggeredAt: new Date() },
      });

      await this._notify(monitor.user.telegramId, monitor.userId,
        `📊 *Limit Order Executed*\n\n` +
        `Side: ${side.toUpperCase()}\n` +
        `Token: ${tokenAddress}\n` +
        `Price: $${currentPrice.toFixed(8)}\n` +
        `Result: ${result.success ? '✅ Success' : '❌ ' + result.error}`
      );
    } catch (err) {
      logger.error('Limit order execution failed', { monitorId: monitor.id, error: err.message });
    }
  }

  // ── WALLET_TRACK (decode txs + mirror trading) ──────────────────────
  async _checkWalletTrack(monitor) {
    const params = typeof monitor.params === 'string' ? JSON.parse(monitor.params) : monitor.params;
    const { walletAddress, mirror, mirrorAmountUsd } = params;

    const provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
    const currentBlock = await provider.getBlockNumber();

    // Resume from last processed block; on first run scan last 100 blocks
    const lastBlock = params._lastBlock || (currentBlock - 100);
    const fromBlock = lastBlock + 1;

    // Already up to date
    if (fromBlock > currentBlock) return;

    // Cap scan range to 500 blocks to avoid RPC limits
    const toBlock = Math.min(currentBlock, fromBlock + 499);

    // Known DEX routers on Base (lowercase)
    const DEX_ROUTERS = new Set([
      '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap Universal Router
      '0x2626664c2603336e57b271c5c0b26f421741e481', // Uniswap V3 Router
      '0xdef1c0ded9bec7f1a1670819833240f027b25eff', // 0x Exchange Proxy
      '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch Router
    ]);

    // WETH on Base — skip mirroring WETH transfers
    const WETH = '0x4200000000000000000000000000000000000006';

    // ERC-20 Transfer(address indexed from, address indexed to, uint256 value)
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const paddedWallet = ethers.zeroPadValue(walletAddress, 32);

    // Fetch Transfer logs where tracked wallet is sender OR receiver
    const [sentLogs, receivedLogs] = await Promise.all([
      provider.getLogs({
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, paddedWallet],       // from = wallet
      }),
      provider.getLogs({
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, null, paddedWallet],  // to = wallet
      }),
    ]);

    // Collect unique tx hashes from all matching logs
    const txHashSet = new Set();
    const allRelevantLogs = [...sentLogs, ...receivedLogs];
    for (const log of allRelevantLogs) {
      txHashSet.add(log.transactionHash);
    }

    const walletLower = walletAddress.toLowerCase();

    // Process each transaction
    for (const txHash of txHashSet) {
      try {
        const tx = await provider.getTransaction(txHash);
        if (!tx || !tx.to) continue;

        const routerAddr = tx.to.toLowerCase();
        // Only interested in transactions that interact with a DEX router
        if (!DEX_ROUTERS.has(routerAddr)) continue;

        // Find the Transfer event involving the tracked wallet
        const txLogs = allRelevantLogs.filter(l => l.transactionHash === txHash);

        let side = null;
        let tokenAddress = null;

        for (const log of txLogs) {
          // topics[1] = from, topics[2] = to (both left-padded 32-byte addresses)
          const fromAddr = ethers.getAddress('0x' + log.topics[1].slice(26));
          const toAddr = ethers.getAddress('0x' + log.topics[2].slice(26));

          if (toAddr.toLowerCase() === walletLower) {
            // Wallet received tokens → BUY
            side = 'buy';
            tokenAddress = log.address; // emitting contract = token
            break;
          } else if (fromAddr.toLowerCase() === walletLower) {
            // Wallet sent tokens → SELL
            side = 'sell';
            tokenAddress = log.address;
            // Keep scanning — a multi-hop buy might also have wallet as sender
            // of an intermediate token, so prefer the "to" match if it comes later
          }
        }

        if (!side || !tokenAddress) continue;
        if (tokenAddress.toLowerCase() === WETH.toLowerCase()) continue;

        // Build alert message
        const sideEmoji = side === 'buy' ? '🟢' : '🔴';
        const sideLabel = side.toUpperCase();

        const baseMessage =
          `${sideEmoji} *Wallet Tracker Alert*\n\n` +
          `Tracked wallet made a *${sideLabel}*:\n` +
          `Token: \`${tokenAddress}\`\n` +
          `Tx: \`${txHash}\`\n` +
          `Block: ${tx.blockNumber}\n\n` +
          `View: ${config.base.explorerTxUrl}/${txHash}`;

        // ── Mirror trading: auto-buy when tracked wallet buys ──
        if (mirror && side === 'buy' && this.tradeOrchestrator) {
          const buyAmountUsd = mirrorAmountUsd || 5;

          // Notify with pending mirror status
          await this._notify(monitor.user.telegramId, monitor.userId,
            baseMessage + `\n\n🪞 Mirror buy executing: $${buyAmountUsd}…`
          );

          try {
            const result = await this.tradeOrchestrator.executeBuy({
              userId: monitor.userId,
              tokenAddress,
              amountUsd: buyAmountUsd,
              slippageBps: config.trade.defaultSlippageBps,
            });

            await this._notify(monitor.user.telegramId, monitor.userId,
              `🪞 *Mirror Buy Result*\n\n` +
              `Token: \`${tokenAddress}\`\n` +
              `Amount: $${buyAmountUsd}\n` +
              `Result: ${result.success ? '✅ Success' : '❌ ' + result.error}`
            );
          } catch (mirrorErr) {
            logger.error('Mirror buy failed', { monitorId: monitor.id, error: mirrorErr.message });
            await this._notify(monitor.user.telegramId, monitor.userId,
              `🪞 *Mirror Buy Failed*\n\n` +
              `Token: \`${tokenAddress}\`\n` +
              `Error: ${mirrorErr.message}`
            );
          }
        } else {
          // Standard notification (no mirror)
          await this._notify(monitor.user.telegramId, monitor.userId, baseMessage);
        }
      } catch (txErr) {
        logger.error('Wallet tracker tx processing failed', { txHash, error: txErr.message });
      }
    }

    // Persist last processed block so we don't re-scan
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        params: { ...params, _lastBlock: toBlock },
      },
    });
  }

  // ── DCA (Dollar Cost Average — buy periodically) ─────────────────────
  async _checkDca(monitor) {
    const params = typeof monitor.params === 'string' ? JSON.parse(monitor.params) : monitor.params;
    const { tokenAddress, amountUsd, intervalSeconds, totalExecutions, executedCount } = params;

    const completed = executedCount || 0;
    const total = totalExecutions || 0;

    if (total > 0 && completed >= total) {
      await prisma.monitor.update({
        where: { id: monitor.id },
        data: { status: 'TRIGGERED', triggeredAt: new Date() },
      });
      return;
    }

    try {
      const result = await this.tradeOrchestrator.executeBuy({
        userId: monitor.userId,
        tokenAddress,
        amountUsd: amountUsd || 5,
        slippageBps: config.trade.defaultSlippageBps,
      });

      const newCompleted = completed + 1;
      const nextRun = new Date(Date.now() + (intervalSeconds || 86400) * 1000);

      await prisma.monitor.update({
        where: { id: monitor.id },
        data: {
          params: { ...params, executedCount: newCompleted },
          nextRunAt: total > 0 && newCompleted >= total ? undefined : nextRun,
          status: total > 0 && newCompleted >= total ? 'TRIGGERED' : 'WATCHING',
          triggeredAt: total > 0 && newCompleted >= total ? new Date() : undefined,
        },
      });

      await this._notify(monitor.user.telegramId, monitor.userId,
        `🔄 *DCA Buy Executed*\n\n` +
        `Token: ${tokenAddress}\n` +
        `Amount: $${amountUsd || 5}\n` +
        `Progress: ${newCompleted}/${total || '∞'}\n` +
        `Result: ${result.success ? '✅' : '❌ ' + result.error}`
      );
    } catch (err) {
      logger.error('DCA execution failed', { monitorId: monitor.id, error: err.message });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  async _notify(telegramId, userId, text) {
    if (this.notificationService && telegramId) {
      try {
        await this.notificationService.sendMessage(telegramId, text);
      } catch (err) {
        logger.error('MonitorRunner notification failed', { userId, error: err.message });
      }
    }
  }
}

module.exports = MonitorRunner;
