/**
 * Conversation manager — stores conversation history in Redis.
 */

const { getRedis } = require('../../lib/redis');

const MAX_MESSAGES = 20;
const TTL_SECONDS = 3600; // 1 hour

class ConversationManager {
  constructor() {
    this.memoryStore = new Map(); // fallback if no Redis
  }

  getKey(userId) {
    return `conv:${userId}`;
  }

  async getHistory(userId) {
    const redis = getRedis();
    if (redis) {
      try {
        const data = await redis.get(this.getKey(userId));
        return data ? JSON.parse(data) : [];
      } catch {
        return this.memoryStore.get(userId) || [];
      }
    }
    return this.memoryStore.get(userId) || [];
  }

  async addMessage(userId, role, content) {
    const history = await this.getHistory(userId);
    history.push({ role, content });

    // Keep only last N messages
    const trimmed = history.slice(-MAX_MESSAGES);

    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(this.getKey(userId), JSON.stringify(trimmed), { ex: TTL_SECONDS });
      } catch {
        this.memoryStore.set(userId, trimmed);
      }
    } else {
      this.memoryStore.set(userId, trimmed);
    }
  }

  async clearHistory(userId) {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.del(this.getKey(userId));
      } catch {}
    }
    this.memoryStore.delete(userId);
  }
}

module.exports = new ConversationManager();
