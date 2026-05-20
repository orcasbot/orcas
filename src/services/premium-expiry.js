/**
 * Premium expiry service — checks for expired premium subscriptions
 * and sets isPremium to false. Runs every 5 minutes.
 */

const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const config = require('../config');

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

class PremiumExpiryService {
  constructor() {
    this.intervalId = null;
    this.running = false;
  }

  start() {
    if (this.running) return Promise.resolve();
    this.running = true;
    logger.info('PremiumExpiryService started');
    // Run immediately, then on interval
    this._tick().catch(err => logger.error('PremiumExpiry tick error', { error: err.message }));
    this.intervalId = setInterval(() => this._tick().catch(err => {
      logger.error('PremiumExpiry tick error', { error: err.message });
    }), POLL_INTERVAL_MS);
    return Promise.resolve();
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.running = false;
    logger.info('PremiumExpiryService stopped');
  }

  async _tick() {
    const now = new Date();

    // Find all premium users whose premiumUntil has passed
    const expired = await prisma.user.updateMany({
      where: {
        isPremium: true,
        premiumUntil: { lt: now },
      },
      data: {
        isPremium: false,
      },
    });

    if (expired.count > 0) {
      logger.info('Premium subscriptions expired', { count: expired.count });
    }
  }
}

module.exports = PremiumExpiryService;
