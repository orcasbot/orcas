/**
 * Telegram bot setup — Grammy framework.
 */

const { Bot, GrammyError, HttpError } = require('grammy');
const config = require('../config');
const logger = require('../utils/logger');
const prisma = require('../lib/prisma');
const conversationManager = require('../services/llm/conversation-manager');

function createBot(claudeClient, llmRateLimiter) {
  const bot = new Bot(config.telegram.botToken);

  // Middleware: parse user
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      ctx.userId = ctx.from.id.toString();
      ctx.username = ctx.from.username;
    }
    await next();
  });

  // /start command
  bot.command('start', async (ctx) => {
    const telegramId = ctx.userId;

    // Find or create user
    let user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          telegramUsername: ctx.username,
        },
      });
      user._isNewUser = true;
    }

    // Process through Claude
    const limitCheck = llmRateLimiter.canProceed(telegramId);
    if (!limitCheck.allowed) {
      return ctx.reply(limitCheck.reason);
    }

    await conversationManager.addMessage(telegramId, 'user', '/start');

    const response = await claudeClient.processMessage(
      user,
      await conversationManager.getHistory(telegramId),
      user.id
    );

    await conversationManager.addMessage(telegramId, 'assistant', response.text);
    await ctx.reply(response.text, { parse_mode: 'Markdown' });
  });

  // /clear command
  bot.command('clear', async (ctx) => {
    await conversationManager.clearHistory(ctx.userId);
    await ctx.reply('Conversation cleared.');
  });

  // Message handler — route everything through Claude
  bot.on('message:text', async (ctx) => {
    const telegramId = ctx.userId;
    const message = ctx.message.text;

    // Skip commands
    if (message.startsWith('/')) return;

    // Rate limit check
    const limitCheck = llmRateLimiter.canProceed(telegramId);
    if (!limitCheck.allowed) {
      return ctx.reply(limitCheck.reason);
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { telegramId },
      include: { wallets: true, settings: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          telegramUsername: ctx.username,
        },
        include: { wallets: true, settings: true },
      });
      user._isNewUser = true;
    }

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    try {
      // Add user message to history
      await conversationManager.addMessage(telegramId, 'user', message);

      // Process through Claude
      const response = await claudeClient.processMessage(
        user,
        await conversationManager.getHistory(telegramId),
        user.id
      );

      // Add assistant response to history
      await conversationManager.addMessage(telegramId, 'assistant', response.text);

      // Send response (split by --- for multi-message)
      const parts = response.text.split(/\n---\n/);
      for (const part of parts) {
        if (part.trim()) {
          await ctx.reply(part.trim(), { parse_mode: 'Markdown' });
        }
      }
    } catch (err) {
      logger.error('Message processing failed', { error: err.message, userId: telegramId });
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // Error handler
  bot.catch((err) => {
    const ctx = err.ctx;
    const error = err.error;

    if (error instanceof GrammyError) {
      logger.error('Grammy error', { error: error.description });
    } else if (error instanceof HttpError) {
      logger.error('HTTP error', { error: error.message });
    } else {
      logger.error('Unknown error', { error: error.message });
    }
  });

  return bot;
}

module.exports = { createBot };
