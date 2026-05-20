/**
 * Tests for PriceOracle — DEXScreener + CoinGecko price fetching.
 */

const axios = require('axios');

// Mock axios before importing PriceOracle
jest.mock('axios');
const mockAxios = /** @type {jest.Mocked<typeof axios>} */ (axios);

// PriceOracle is a singleton — require after mocking
const priceOracle = require('../../src/services/price-oracle');

describe('PriceOracle', () => {
  beforeEach(() => {
    // Clear the internal cache between tests
    priceOracle.cache.clear();
    jest.clearAllMocks();
  });

  // ── getEthPrice ────────────────────────────────────────────────────
  describe('getEthPrice', () => {
    test('fetches ETH price from CoinGecko', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: { ethereum: { usd: 3456.78 } },
      });

      const price = await priceOracle.getEthPrice();
      expect(price).toBe(3456.78);
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://api.coingecko.com/api/v3/simple/price',
        expect.objectContaining({
          params: { ids: 'ethereum', vs_currencies: 'usd' },
          timeout: 5000,
        })
      );
    });

    test('returns cached price within TTL', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: { ethereum: { usd: 3500 } },
      });

      const first = await priceOracle.getEthPrice();
      const second = await priceOracle.getEthPrice();

      expect(first).toBe(3500);
      expect(second).toBe(3500);
      // Only one API call — second was cached
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });

    test('refetches after cache expires', async () => {
      mockAxios.get
        .mockResolvedValueOnce({ data: { ethereum: { usd: 3500 } } })
        .mockResolvedValueOnce({ data: { ethereum: { usd: 3600 } } });

      const first = await priceOracle.getEthPrice();
      expect(first).toBe(3500);

      // Expire the cache manually
      const cached = priceOracle.cache.get('ETH_USD');
      cached.ts = Date.now() - 31_000;

      const second = await priceOracle.getEthPrice();
      expect(second).toBe(3600);
      expect(mockAxios.get).toHaveBeenCalledTimes(2);
    });

    test('returns cached price on API failure', async () => {
      // Prime the cache
      mockAxios.get.mockResolvedValueOnce({ data: { ethereum: { usd: 3500 } } });
      await priceOracle.getEthPrice();

      // Make next call fail
      mockAxios.get.mockRejectedValueOnce(new Error('Network error'));

      // Expire cache
      const cached = priceOracle.cache.get('ETH_USD');
      cached.ts = Date.now() - 31_000;

      const price = await priceOracle.getEthPrice();
      expect(price).toBe(3500); // stale cache fallback
    });

    test('returns 0 on API failure with no cache', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('timeout'));

      const price = await priceOracle.getEthPrice();
      expect(price).toBe(0);
    });
  });

  // ── getTokenPrice ──────────────────────────────────────────────────
  describe('getTokenPrice', () => {
    const tokenAddr = '0x1234567890abcdef1234567890abcdef12345678';

    test('fetches and returns token price from DEXScreener', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          pairs: [
            {
              chainId: 'base',
              priceUsd: '0.0042',
              priceChange: { m5: 1.5, h1: -2.3, h24: 15.7 },
              volume: { h24: 50000 },
              liquidity: { usd: 150000 },
              pairAddress: '0xpair',
              dexId: 'uniswap',
              pairCreatedAt: 1700000000000,
              baseToken: { address: tokenAddr, symbol: 'TEST' },
              quoteToken: { symbol: 'WETH' },
            },
          ],
        },
      });

      const price = await priceOracle.getTokenPrice(tokenAddr);

      expect(price).not.toBeNull();
      expect(price.usd).toBe(0.0042);
      expect(price.priceChange5m).toBe(1.5);
      expect(price.priceChange1h).toBe(-2.3);
      expect(price.priceChange24h).toBe(15.7);
      expect(price.volume24h).toBe(50000);
      expect(price.liquidityUsd).toBe(150000);
      expect(price.pairAddress).toBe('0xpair');
    });

    test('returns null when no pairs exist', async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { pairs: [] } });

      const price = await priceOracle.getTokenPrice(tokenAddr);
      expect(price).toBeNull();
    });

    test('returns null when pairs is null', async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { pairs: null } });

      const price = await priceOracle.getTokenPrice(tokenAddr);
      expect(price).toBeNull();
    });

    test('filters for Base chain pairs only', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          pairs: [
            { chainId: 'ethereum', priceUsd: '1.00', liquidity: { usd: 1000000 } },
            {
              chainId: 'base',
              priceUsd: '0.50',
              liquidity: { usd: 50000 },
              priceChange: {},
              volume: {},
              baseToken: {},
              quoteToken: {},
            },
          ],
        },
      });

      const price = await priceOracle.getTokenPrice(tokenAddr);
      expect(price).not.toBeNull();
      expect(price.usd).toBe(0.5);
    });

    test('selects pair with highest liquidity', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          pairs: [
            {
              chainId: 'base',
              priceUsd: '0.10',
              liquidity: { usd: 10000 },
              priceChange: {},
              volume: {},
              baseToken: {},
              quoteToken: {},
              pairAddress: '0xlow',
            },
            {
              chainId: 'base',
              priceUsd: '0.12',
              liquidity: { usd: 500000 },
              priceChange: {},
              volume: {},
              baseToken: {},
              quoteToken: {},
              pairAddress: '0xhigh',
            },
          ],
        },
      });

      const price = await priceOracle.getTokenPrice(tokenAddr);
      expect(price.pairAddress).toBe('0xhigh');
      expect(price.usd).toBe(0.12);
    });

    test('returns cached price within TTL', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          pairs: [
            {
              chainId: 'base',
              priceUsd: '0.0042',
              liquidity: { usd: 100000 },
              priceChange: {},
              volume: {},
              baseToken: {},
              quoteToken: {},
            },
          ],
        },
      });

      await priceOracle.getTokenPrice(tokenAddr);
      await priceOracle.getTokenPrice(tokenAddr);

      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });

    test('returns null on API failure with no cache', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Rate limited'));

      const price = await priceOracle.getTokenPrice(tokenAddr);
      expect(price).toBeNull();
    });

    test('returns cached price on API failure', async () => {
      // Prime cache
      mockAxios.get.mockResolvedValueOnce({
        data: {
          pairs: [
            {
              chainId: 'base',
              priceUsd: '0.005',
              liquidity: { usd: 100000 },
              priceChange: {},
              volume: {},
              baseToken: {},
              quoteToken: {},
            },
          ],
        },
      });
      await priceOracle.getTokenPrice(tokenAddr);

      // Expire + fail
      const cached = priceOracle.cache.get(`token:${tokenAddr}`);
      cached.ts = Date.now() - 31_000;
      mockAxios.get.mockRejectedValueOnce(new Error('timeout'));

      const price = await priceOracle.getTokenPrice(tokenAddr);
      expect(price.usd).toBe(0.005);
    });
  });

  // ── getTrendingTokens ──────────────────────────────────────────────
  describe('getTrendingTokens', () => {
    test('returns Base chain trending tokens', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: [
          { chainId: 'base', tokenAddress: '0xaaa' },
          { chainId: 'ethereum', tokenAddress: '0xbbb' },
          { chainId: 'base', tokenAddress: '0xccc' },
        ],
      });

      const results = await priceOracle.getTrendingTokens();
      expect(results).toHaveLength(2);
      expect(results.every(t => t.chainId === 'base')).toBe(true);
    });

    test('limits results to 20', async () => {
      const tokens = Array.from({ length: 30 }, (_, i) => ({
        chainId: 'base',
        tokenAddress: `0x${i.toString().padStart(40, '0')}`,
      }));
      mockAxios.get.mockResolvedValueOnce({ data: tokens });

      const results = await priceOracle.getTrendingTokens();
      expect(results).toHaveLength(20);
    });

    test('returns empty array on API failure', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('fail'));

      const results = await priceOracle.getTrendingTokens();
      expect(results).toEqual([]);
    });
  });

  // ── searchToken ────────────────────────────────────────────────────
  describe('searchToken', () => {
    test('returns Base chain search results', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          pairs: [
            {
              chainId: 'base',
              baseToken: { address: '0xaaa', symbol: 'DOGE', name: 'DogeCoin' },
              priceUsd: '0.10',
              liquidity: { usd: 50000 },
              volume: { h24: 10000 },
              pairAddress: '0xpair1',
            },
            {
              chainId: 'ethereum',
              baseToken: { address: '0xbbb', symbol: 'DOGE', name: 'DogeCoin' },
              priceUsd: '0.10',
              liquidity: { usd: 200000 },
              volume: { h24: 50000 },
              pairAddress: '0xpair2',
            },
          ],
        },
      });

      const results = await priceOracle.searchToken('DOGE');
      expect(results).toHaveLength(1);
      expect(results[0].address).toBe('0xaaa');
      expect(results[0].symbol).toBe('DOGE');
    });

    test('limits results to 10', async () => {
      const pairs = Array.from({ length: 20 }, (_, i) => ({
        chainId: 'base',
        baseToken: { address: `0x${i.toString().padStart(40, '0')}`, symbol: `T${i}`, name: `Token${i}` },
        priceUsd: '1.0',
        liquidity: { usd: 1000 },
        volume: { h24: 100 },
        pairAddress: `0xp${i}`,
      }));
      mockAxios.get.mockResolvedValueOnce({ data: { pairs } });

      const results = await priceOracle.searchToken('T');
      expect(results).toHaveLength(10);
    });

    test('returns empty array on API failure', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('fail'));

      const results = await priceOracle.searchToken('TEST');
      expect(results).toEqual([]);
    });

    test('handles missing pairs gracefully', async () => {
      mockAxios.get.mockResolvedValueOnce({ data: {} });

      const results = await priceOracle.searchToken('TEST');
      expect(results).toEqual([]);
    });
  });
});
