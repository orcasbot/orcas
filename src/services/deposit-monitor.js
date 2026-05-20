/**
 * Deposit monitor — watches for incoming ETH deposits to user wallets.
 * Polls recent blocks on Base for native ETH transfers to tracked addresses.
 */

const { ethers } = require('ethers');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const config = require('../config');

const POLL_INTERVAL_MS = 12_000; // ~Base block time
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

class DepositMonitor {
  constructor(notificationService) {
    this.notificationService = notificationService;
    this.intervalId = null;
    this.running = false;
    this.lastBlock = null;
    this.provider = null;
    // Map of lowercase address -> { userId, telegramId }
    this.trackedAddresses = new Map();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
    this.lastBlock = await this.provider.getBlockNumber() - 5;
    await this._refreshTrackedAddresses();
    logger.info('DepositMonitor started', { lastBlock: this.lastBlock, trackedCount: this.trackedAddresses.size });

    this.intervalId = setInterval(() => this._tick().catch(err => {
      logger.error('DepositMonitor tick error', { error: err.message });
    }), POLL_INTERVAL_MS);

    // Refresh tracked addresses every 2 minutes
    this.refreshInterval = setInterval(() => this._refreshTrackedAddresses().catch(() => {}), 120_000);
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    if (this.refreshInterval) { clearInterval(this.refreshInterval); this.refreshInterval = null; }
    this.running = false;
    logger.info('DepositMonitor stopped');
  }

  async _refreshTrackedAddresses() {
    const wallets = await prisma.wallet.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, telegramId: true } } },
    });

    this.trackedAddresses.clear();
    for (const w of wallets) {
      this.trackedAddresses.set(w.address.toLowerCase(), {
        userId: w.userId,
        telegramId: w.user.telegramId,
      });
    }
  }

  async _tick() {
    const currentBlock = await this.provider.getBlockNumber();
    if (currentBlock <= this.lastBlock) return;

    // Process in chunks of 50 blocks max
    const fromBlock = this.lastBlock + 1;
    const toBlock = Math.min(currentBlock, fromBlock + 49);

    // Check for ETH transfers using trace/filter — native ETH has no Transfer event,
    // so we check block transactions directly via getBalance or traces.
    // Simpler approach: poll balance changes for tracked addresses.
    for (const [address, info] of this.trackedAddresses) {
      try {
        const balance = await this.provider.getBalance(address, toBlock);
        const prevBalance = await this.provider.getBalance(address, fromBlock - 1);
        const diff = balance - prevBalance;

        if (diff > 0n) {
          const ethReceived = parseFloat(ethers.formatEther(diff));
          // Only notify for deposits > 0.0001 ETH to avoid dust noise
          if (ethReceived > 0.0001) {
            logger.info('ETH deposit detected', { address, ethReceived, userId: info.userId });
            await this._notifyDeposit(info, address, ethReceived, toBlock);
          }
        }
      } catch (err) {
        logger.warn('DepositMonitor address check failed', { address, error: err.message });
      }
    }

    this.lastBlock = toBlock;
  }

  async _notifyDeposit(info, address, ethReceived, blockNumber) {
    if (this.notificationService && info.telegramId) {
      const ethPrice = await this._getEthPrice();
      const usdValue = ethPrice ? (ethReceived * ethPrice).toFixed(2) : '?';

      const text = `💰 *ETH Deposit Received*\n\n` +
        `Amount: ${ethReceived.toFixed(6)} ETH (~$${usdValue})\n` +
        `Wallet: \`${address}\`\n` +
        `Block: ${blockNumber}\n\n` +
        `View: ${config.base.explorerAddressUrl}/${address}`;

      try {
        await this.notificationService.sendMessage(info.telegramId, text);
      } catch (err) {
        logger.error('DepositMonitor notification failed', { error: err.message });
      }
    }
  }

  async _getEthPrice() {
    try {
      const priceOracle = require('./price-oracle');
      return await priceOracle.getEthPrice();
    } catch {
      return null;
    }
  }
}

module.exports = DepositMonitor;
