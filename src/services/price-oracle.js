/**
 * Price oracle — fetches token prices from DEXScreener + CoinGecko.
 */

const axios = require('axios');
const logger = require('../utils/logger');

const WETH_BASE = '0x4200000000000000000000000000000000000006';

class PriceOracle {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 30_000; // 30s
  }

  /**
   * Get ETH price in USD
   */
  async getEthPrice() {
    const cached = this.cache.get('ETH_USD');
    if (cached && Date.now() - cached.ts < this.cacheTTL) return cached.price;

    try {
      const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: 'ethereum', vs_currencies: 'usd' },
        timeout: 5000,
      });
      const price = res.data.ethereum.usd;
      this.cache.set('ETH_USD', { price, ts: Date.now() });
      return price;
    } catch (err) {
      logger.warn('CoinGecko ETH price failed', { error: err.message });
      return cached?.price || 0;
    }
  }

  /**
   * Get token price from DEXScreener
   */
  async getTokenPrice(tokenAddress) {
    const cacheKey = `token:${tokenAddress}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.cacheTTL) return cached.price;

    try {
      const res = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 5000 }
      );

      const pairs = res.data.pairs;
      if (!pairs || pairs.length === 0) return null;

      // Filter for Base chain pairs, sort by liquidity
      const basePairs = pairs.filter(p => p.chainId === 'base');
      if (basePairs.length === 0) return null;

      const bestPair = basePairs.sort(
        (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];

      const price = {
        usd: parseFloat(bestPair.priceUsd) || 0,
        priceChange5m: bestPair.priceChange?.m5 || 0,
        priceChange1h: bestPair.priceChange?.h1 || 0,
        priceChange24h: bestPair.priceChange?.h24 || 0,
        volume24h: bestPair.volume?.h24 || 0,
        liquidityUsd: bestPair.liquidity?.usd || 0,
        pairAddress: bestPair.pairAddress,
        dexId: bestPair.dexId,
        pairCreatedAt: bestPair.pairCreatedAt,
        baseToken: bestPair.baseToken,
        quoteToken: bestPair.quoteToken,
      };

      this.cache.set(cacheKey, { price, ts: Date.now() });
      return price;
    } catch (err) {
      logger.warn('DEXScreener price failed', { tokenAddress, error: err.message });
      return cached?.price || null;
    }
  }

  /**
   * Get trending tokens on Base
   */
  async getTrendingTokens() {
    try {
      const res = await axios.get(
        'https://api.dexscreener.com/token-profiles/latest/v1',
        { timeout: 5000 }
      );

      const baseTokens = res.data
        .filter(t => t.chainId === 'base')
        .slice(0, 20);

      return baseTokens;
    } catch (err) {
      logger.warn('DEXScreener trending failed', { error: err.message });
      return [];
    }
  }

  /**
   * Search tokens by name/symbol
   */
  async searchToken(query) {
    try {
      const res = await axios.get(
        `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(query)}`,
        { timeout: 5000 }
      );

      const results = res.data.pairs
        ?.filter(p => p.chainId === 'base')
        .slice(0, 10)
        .map(p => ({
          address: p.baseToken.address,
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          priceUsd: parseFloat(p.priceUsd) || 0,
          liquidityUsd: p.liquidity?.usd || 0,
          volume24h: p.volume?.h24 || 0,
          pairAddress: p.pairAddress,
        })) || [];

      return results;
    } catch (err) {
      logger.warn('DEXScreener search failed', { error: err.message });
      return [];
    }
  }
}

module.exports = new PriceOracle();
