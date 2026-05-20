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

  // ── WALLET_TRACK (check for new outgoing txs from tracked wallet) ────
  async _checkWalletTrack(monitor) {
    const params = typeof monitor.params === 'string' ? JSON.parse(monitor.params) : monitor.params;
    const { watchAddress } = params;

    // Use DEXScreener to check if the tracked wallet has recent activity
    // Simpler approach: check recent trades in our DB for this address or use provider
    const provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
    const currentBlock = await provider.getBlockNumber();

    // Check last 100 blocks for outgoing txs
    const fromBlock = currentBlock - 100;
    const lastCheckedBlock = params._lastBlock || fromBlock;

    // Get transaction count diff to detect activity
    const currentNonce = await provider.getTransactionCount(watchAddress, currentBlock);
    const prevNonce = params._lastNonce ?? currentNonce;

    if (currentNonce > prevNonce) {
      await this._notify(monitor.user.telegramId, monitor.userId,
        `👀 *Wallet Activity*\n\n` +
        `Wallet: \`${watchAddress}\`\n` +
        `New transactions: ${currentNonce - prevNonce}\n\n` +
        `View: ${config.base.explorerAddressUrl}/${watchAddress}`
      );
    }

    // Update params with last known state
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        params: { ...params, _lastBlock: currentBlock, _lastNonce: currentNonce },
      },
    });
  }

  // ── DCA (Dollar Cost Average — buy periodically) ─────────────────────
  async _checkDca(monitor) {
    const params = typeof monitor.params === 'string' ? JSON.parse(monitor.params) : monitor.params;
    const { tokenAddress, amountUsd, intervalHours, totalExecutions, executionsCompleted } = params;

    const completed = executionsCompleted || 0;
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
      const nextRun = new Date(Date.now() + (intervalHours || 24) * 3600_000);

      await prisma.monitor.update({
        where: { id: monitor.id },
        data: {
          params: { ...params, executionsCompleted: newCompleted },
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
