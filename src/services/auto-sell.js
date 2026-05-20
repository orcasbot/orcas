/**
 * Auto-sell service — monitors user positions and triggers TP/SL.
 * Polls every 15s, checks takeProfitPct/stopLossPct against current prices.
 */

const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const config = require('../config');
const priceOracle = require('./price-oracle');

const POLL_INTERVAL_MS = 15_000;

class AutoSellService {
  constructor(io, orchestrator, notifications) {
    this.io = io;
    this.orchestrator = orchestrator;
    this.notifications = notifications;
    this.intervalId = null;
    this.running = false;
  }

  start() {
    if (this.running) return Promise.resolve();
    this.running = true;
    logger.info('AutoSell service started');
    this.intervalId = setInterval(() => this._tick().catch(err => {
      logger.error('AutoSell tick error', { error: err.message });
    }), POLL_INTERVAL_MS);
    return Promise.resolve();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    logger.info('AutoSell service stopped');
  }

  async _tick() {
    const settings = await prisma.userSettings.findMany({
      where: {
        autoSellEnabled: true,
        OR: [
          { takeProfitPct: { not: null } },
          { stopLossPct: { not: null } },
        ],
      },
      include: { user: { include: { wallets: { where: { isActive: true } } } } },
    });

    for (const setting of settings) {
      try {
        await this._checkUser(setting);
      } catch (err) {
        logger.error('AutoSell user check failed', { userId: setting.userId, error: err.message });
      }
    }
  }

  async _checkUser(setting) {
    const userId = setting.userId;
    const takeProfitPct = setting.takeProfitPct ? parseFloat(setting.takeProfitPct) : null;
    const stopLossPct = setting.stopLossPct ? parseFloat(setting.stopLossPct) : null;

    const buyTrades = await prisma.trade.findMany({
      where: { userId, action: 'BUY', txStatus: 'CONFIRMED' },
    });

    const positions = new Map();
    for (const t of buyTrades) {
      const key = t.tokenAddress.toLowerCase();
      if (!positions.has(key)) {
        positions.set(key, {
          tokenAddress: t.tokenAddress,
          tokenSymbol: t.tokenSymbol,
          totalBought: 0,
          totalSpentUsd: 0,
          avgBuyPriceUsd: 0,
        });
      }
      const p = positions.get(key);
      p.totalBought += parseFloat(t.amountIn);
      p.totalSpentUsd += parseFloat(t.amountInUsd || 0);
    }

    const sellTrades = await prisma.trade.findMany({
      where: { userId, action: 'SELL', txStatus: 'CONFIRMED' },
    });
    for (const s of sellTrades) {
      const p = positions.get(s.tokenAddress.toLowerCase());
      if (p) p.totalBought -= parseFloat(s.amountIn);
    }

    const active = Array.from(positions.values()).filter(p => p.totalBought > 0);

    for (const pos of active) {
      pos.avgBuyPriceUsd = pos.totalSpentUsd / pos.totalBought;

      const priceData = await priceOracle.getTokenPrice(pos.tokenAddress);
      if (!priceData || !priceData.usd) continue;

      const currentPrice = priceData.usd;
      const changePct = ((currentPrice - pos.avgBuyPriceUsd) / pos.avgBuyPriceUsd) * 100;

      if (takeProfitPct !== null && changePct >= takeProfitPct) {
        logger.info('AutoSell TP triggered', { userId, token: pos.tokenSymbol, changePct: changePct.toFixed(2) });
        await this._executeSell(userId, pos, 'TAKE_PROFIT');
      } else if (stopLossPct !== null && changePct <= -Math.abs(stopLossPct)) {
        logger.info('AutoSell SL triggered', { userId, token: pos.tokenSymbol, changePct: changePct.toFixed(2) });
        await this._executeSell(userId, pos, 'STOP_LOSS');
      }
    }
  }

  async _executeSell(userId, position, reason) {
    try {
      const result = await this.orchestrator.executeSell({
        userId,
        tokenAddress: position.tokenAddress,
        percentage: 100,
      });

      if (result.success) {
        const text = `🐋 Auto-Sell (${reason})\n\n` +
          `Token: ${position.tokenSymbol || position.tokenAddress}\n` +
          `P&L: ${reason === 'TAKE_PROFIT' ? '✅' : '❌'}\n` +
          `TX: ${config.base.explorerTxUrl}/${result.txHash}`;

        await this.notifications.send(userId, text);
        logger.info('AutoSell executed', { userId, reason, token: position.tokenSymbol });
      } else {
        logger.error('AutoSell execution failed', { userId, token: position.tokenAddress, error: result.error });
      }
    } catch (err) {
      logger.error('AutoSell execution error', { userId, error: err.message });
    }
  }
}

module.exports = AutoSellService;
