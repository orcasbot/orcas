/**
 * LLM rate limiter — prevents abuse.
 */

const logger = require('../../utils/logger');

class LlmRateLimiter {
  constructor() {
    this.userLimits = new Map(); // userId -> { count, resetAt }
    this.maxPerMinute = 10;
    this.maxPerDay = 100;
  }

  canProceed(userId) {
    const now = Date.now();
    let userLimit = this.userLimits.get(userId);

    if (!userLimit || now > userLimit.resetAt) {
      userLimit = { minuteCount: 0, dayCount: 0, minuteResetAt: now + 60000, dayResetAt: now + 86400000 };
      this.userLimits.set(userId, userLimit);
    }

    if (now > userLimit.minuteResetAt) {
      userLimit.minuteCount = 0;
      userLimit.minuteResetAt = now + 60000;
    }

    if (userLimit.minuteCount >= this.maxPerMinute) {
      return { allowed: false, reason: 'Rate limit: too many messages per minute' };
    }

    if (userLimit.dayCount >= this.maxPerDay) {
      return { allowed: false, reason: 'Rate limit: daily limit reached' };
    }

    userLimit.minuteCount++;
    userLimit.dayCount++;
    return { allowed: true };
  }
}

module.exports = LlmRateLimiter;
