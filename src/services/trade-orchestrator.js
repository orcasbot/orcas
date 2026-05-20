/**
 * Trade orchestrator — executes buys/sells on Base chain.
 */

const prisma = require('../lib/prisma');
const baseSwap = require('./swap/base-swap');
const priceOracle = require('./price-oracle');
const { checkTokenSafety } = require('./safety/token-safety');
const logger = require('../utils/logger');
const config = require('../config');
const { ethers } = require('ethers');

const WETH_BASE = '0x4200000000000000000000000000000000000006';

class TradeOrchestrator {
  constructor(io) {
    this.io = io;
    this.notifyUser = null;
    this.onTxSent = null;
  }

  /**
   * Buy a token with ETH
   */
  async executeBuy({ userId, tokenAddress, amountUsd, slippageBps }) {
    // Get user wallet
    const walletService = require('./wallet/wallet-service');
    const walletData = await walletService.getWalletWithKey(userId);
    if (!walletData) throw new Error('No wallet found');

    // Get ETH price to convert USD to ETH
    const ethPrice = await priceOracle.getEthPrice();
    if (!ethPrice) throw new Error('Failed to get ETH price');

    const ethAmount = amountUsd / ethPrice;

    // Check balance
    const balance = await baseSwap.getEthBalance(walletData.address);
    if (parseFloat(balance) < ethAmount + 0.001) {
      throw new Error(`Insufficient balance. Need ~${(ethAmount + 0.001).toFixed(6)} ETH, have ${parseFloat(balance).toFixed(6)} ETH`);
    }

    // Check token safety
    const safety = await checkTokenSafety(tokenAddress);
    if (safety.success && safety.isHoneypot) {
      throw new Error('⚠️ This token appears to be a HONEYPOT. Cannot sell after buying. Trade blocked.');
    }

    // Create pending trade
    const trade = await prisma.trade.create({
      data: {
        userId,
        walletId: walletData.id,
        tokenAddress,
        action: 'BUY',
        inputCurrency: 'ETH',
        amountIn: ethAmount,
        amountInUsd: amountUsd,
        txHash: `PENDING_${Date.now()}`,
        txStatus: 'PENDING',
        riskScore: safety.success ? safety.riskScore : null,
        safetyChecks: safety.success ? safety : null,
      },
    });

    try {
      // Execute swap
      const result = await baseSwap.buyWithEth({
        wallet: { address: walletData.address, privateKey: walletData.privateKey },
        tokenAddress,
        ethAmount,
        slippageBps: slippageBps || config.trade.defaultSlippageBps,
      });

      if (!result.success) {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { txStatus: 'FAILED', errorMessage: result.error },
        });
        return { success: false, error: result.error, tradeId: trade.id };
      }

      // Update trade with tx hash
      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          txHash: result.txHash,
          txStatus: 'SUBMITTED',
          gasFee: result.gasUsed ? ethers.formatEther(BigInt(result.gasUsed) * BigInt(result.effectiveGasPrice || '0')) : null,
        },
      });

      if (this.onTxSent) {
        this.onTxSent({ txHash: result.txHash, userId });
      }

      // Wait for confirmation
      const provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
      const receipt = await provider.waitForTransaction(result.txHash, 1, 30000);

      if (receipt && receipt.status === 1) {
        // Calculate platform fee
        const feeUsd = amountUsd * (config.trade.platformFeeBps / 10000);

        await prisma.trade.update({
          where: { id: trade.id },
          data: {
            txStatus: 'CONFIRMED',
            confirmedAt: new Date(),
            platformFeeUsd: feeUsd,
          },
        });

        const confirmedResult = {
          success: true,
          tradeId: trade.id,
          txHash: result.txHash,
          amountUsd,
          ethAmount,
          feeUsd,
        };

        if (this.notifyUser) {
          this.notifyUser(userId, 'trade:confirmed', confirmedResult);
        }

        return confirmedResult;
      } else {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { txStatus: 'FAILED', errorMessage: 'Transaction reverted on-chain' },
        });
        return { success: false, error: 'Transaction reverted', tradeId: trade.id };
      }
    } catch (err) {
      logger.error('Buy execution failed', { error: err.message, tradeId: trade.id });
      await prisma.trade.update({
        where: { id: trade.id },
        data: { txStatus: 'FAILED', errorMessage: err.message },
      });
      return { success: false, error: err.message, tradeId: trade.id };
    }
  }

  /**
   * Sell a token for ETH
   */
  async executeSell({ userId, tokenAddress, percentage }) {
    const walletService = require('./wallet/wallet-service');
    const walletData = await walletService.getWalletWithKey(userId);
    if (!walletData) throw new Error('No wallet found');

    // Get token balance
    const balance = await baseSwap.getTokenBalance(walletData.address, tokenAddress);
    if (parseFloat(balance) <= 0) {
      throw new Error('No token balance to sell');
    }

    // Calculate sell amount
    const sellAmount = percentage
      ? (parseFloat(balance) * percentage / 100).toString()
      : balance;

    // Get token decimals
    const erc20Abi = ['function decimals() view returns (uint8)'];
    const provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
    const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    const decimals = await contract.decimals();

    // Create pending trade
    const trade = await prisma.trade.create({
      data: {
        userId,
        walletId: walletData.id,
        tokenAddress,
        action: 'SELL',
        amountIn: sellAmount,
        txHash: `SELL_PENDING_${Date.now()}`,
        txStatus: 'PENDING',
        tokenDecimals: decimals,
      },
    });

    try {
      const result = await baseSwap.sellForEth({
        wallet: { address: walletData.address, privateKey: walletData.privateKey },
        tokenAddress,
        tokenAmount: sellAmount,
        tokenDecimals: decimals,
        slippageBps: config.trade.defaultSlippageBps,
      });

      if (!result.success) {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { txStatus: 'FAILED', errorMessage: result.error },
        });
        return { success: false, error: result.error, tradeId: trade.id };
      }

      await prisma.trade.update({
        where: { id: trade.id },
        data: {
          txHash: result.txHash,
          txStatus: 'SUBMITTED',
        },
      });

      if (this.onTxSent) {
        this.onTxSent({ txHash: result.txHash, userId });
      }

      return { success: true, tradeId: trade.id, txHash: result.txHash };
    } catch (err) {
      logger.error('Sell execution failed', { error: err.message });
      await prisma.trade.update({
        where: { id: trade.id },
        data: { txStatus: 'FAILED', errorMessage: err.message },
      });
      return { success: false, error: err.message, tradeId: trade.id };
    }
  }

  /**
   * Get user's token positions
   */
  async getUserTokens(userId) {
    const trades = await prisma.trade.findMany({
      where: { userId, txStatus: 'CONFIRMED', action: 'BUY' },
      orderBy: { createdAt: 'desc' },
    });

    // Group by token and calculate holdings
    const positions = new Map();
    for (const trade of trades) {
      const key = trade.tokenAddress;
      if (!positions.has(key)) {
        positions.set(key, {
          tokenAddress: trade.tokenAddress,
          tokenSymbol: trade.tokenSymbol,
          tokenName: trade.tokenName,
          totalBought: 0,
          totalSpentUsd: 0,
        });
      }
      const pos = positions.get(key);
      pos.totalBought += parseFloat(trade.amountIn);
      pos.totalSpentUsd += parseFloat(trade.amountInUsd || 0);
    }

    // Subtract sells
    const sells = await prisma.trade.findMany({
      where: { userId, txStatus: 'CONFIRMED', action: 'SELL' },
    });

    for (const sell of sells) {
      const pos = positions.get(sell.tokenAddress);
      if (pos) {
        pos.totalBought -= parseFloat(sell.amountIn);
      }
    }

    // Filter out zero/negative positions
    return Array.from(positions.values()).filter(p => p.totalBought > 0);
  }
}

module.exports = TradeOrchestrator;
