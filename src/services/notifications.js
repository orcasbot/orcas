/**
 * Notification service — sends trade notifications via Telegram.
 */

const logger = require('../utils/logger');

class NotificationService {
  constructor(bot) {
    this.bot = bot;
  }

  async sendMessage(chatId, text) {
    try {
      await this.bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error('Failed to send notification', { error: err.message, chatId });
    }
  }

  async notifyTradeConfirmed(userId, data, io) {
    // Send Socket.IO event
    if (io) {
      io.to(`user:${userId}`).emit('trade:confirmed', data);
    }

    // Send Telegram notification
    const text = `✅ Trade Confirmed\n\n` +
      `Token: ${data.tokenSymbol || data.tokenAddress}\n` +
      `Amount: $${data.amountUsd}\n` +
      `TX: https://basescan.org/tx/${data.txHash}`;

    // Get user's telegramId
    const prisma = require('../lib/prisma');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.telegramId) {
      await this.sendMessage(user.telegramId, text);
    }
  }

  async notifyTradeFailed(userId, data, io) {
    if (io) {
      io.to(`user:${userId}`).emit('trade:failed', data);
    }

    const text = `❌ Trade Failed\n\n` +
      `Token: ${data.tokenAddress}\n` +
      `Reason: ${data.error}`;

    const prisma = require('../lib/prisma');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.telegramId) {
      await this.sendMessage(user.telegramId, text);
    }
  }
}

module.exports = NotificationService;
