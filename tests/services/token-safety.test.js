/**
 * Tests for Token Safety checker — GoPlus Security API.
 */

const axios = require('axios');

jest.mock('axios');
const mockAxios = /** @type {jest.Mocked<typeof axios>} */ (axios);

// config and logger are already mocked by setup.js
const { checkTokenSafety } = require('../../src/services/safety/token-safety');

describe('Token Safety — checkTokenSafety', () => {
  const tokenAddr = '0x1234567890abcdef1234567890abcdef12345678';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns safe token with zero risk score', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '0',
            is_open_source: '1',
            is_proxy: '0',
            is_mintable: '0',
            can_take_back_ownership: '0',
            hidden_owner: '0',
            selfdestruct: '0',
            external_call: '0',
            is_blacklisted: '0',
            is_whitelisted: '0',
            is_anti_whale: '0',
            trading_cooldown: '0',
            sell_tax: '0',
            buy_tax: '0',
            holder_count: '1000',
            total_supply: '1000000000',
            owner_address: '0xowner',
            creator_address: '0xcreator',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    expect(result.riskScore).toBe(0);
    expect(result.risks).toHaveLength(0);
    expect(result.isHoneypot).toBe(false);
    expect(result.isOpenSource).toBe(true);
    expect(result.buyTax).toBe(0);
    expect(result.sellTax).toBe(0);
    expect(result.holderCount).toBe(1000);
  });

  test('detects honeypot (CRITICAL)', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '1',
            is_open_source: '1',
            is_proxy: '0',
            is_mintable: '0',
            can_take_back_ownership: '0',
            hidden_owner: '0',
            selfdestruct: '0',
            external_call: '0',
            is_blacklisted: '0',
            is_whitelisted: '0',
            is_anti_whale: '0',
            trading_cooldown: '0',
            sell_tax: '0',
            buy_tax: '0',
            holder_count: '50',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    expect(result.isHoneypot).toBe(true);
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0].type).toBe('HONEYPOT');
    expect(result.risks[0].severity).toBe('CRITICAL');
    expect(result.riskScore).toBe(40);
  });

  test('detects multiple high-severity risks', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '0',
            is_open_source: '0',
            is_proxy: '0',
            is_mintable: '1',
            can_take_back_ownership: '1',
            hidden_owner: '0',
            selfdestruct: '1',
            external_call: '0',
            is_blacklisted: '1',
            is_whitelisted: '0',
            is_anti_whale: '0',
            trading_cooldown: '0',
            sell_tax: '0',
            buy_tax: '0',
            holder_count: '100',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    // closed_source(20) + mintable(20) + takeback(20) + selfdestruct(20) + blacklist(20) = 100
    expect(result.riskScore).toBe(100);
    expect(result.risks.length).toBeGreaterThanOrEqual(4);
  });

  test('caps risk score at 100', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '1',
            is_open_source: '0',
            is_proxy: '1',
            is_mintable: '1',
            can_take_back_ownership: '1',
            hidden_owner: '1',
            selfdestruct: '1',
            external_call: '1',
            is_blacklisted: '1',
            is_whitelisted: '1',
            is_anti_whale: '1',
            trading_cooldown: '1',
            sell_tax: '0.5',
            buy_tax: '0.3',
            holder_count: '10',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  test('detects high sell tax', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '0',
            is_open_source: '1',
            is_proxy: '0',
            is_mintable: '0',
            can_take_back_ownership: '0',
            hidden_owner: '0',
            selfdestruct: '0',
            external_call: '0',
            is_blacklisted: '0',
            is_whitelisted: '0',
            is_anti_whale: '0',
            trading_cooldown: '0',
            sell_tax: '0.15',
            buy_tax: '0',
            holder_count: '500',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    expect(result.sellTax).toBeCloseTo(0.15);
    const highSellTax = result.risks.find(r => r.type === 'HIGH_SELL_TAX');
    expect(highSellTax).toBeDefined();
    expect(highSellTax.severity).toBe('HIGH');
  });

  test('detects high buy tax', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '0',
            is_open_source: '1',
            is_proxy: '0',
            is_mintable: '0',
            can_take_back_ownership: '0',
            hidden_owner: '0',
            selfdestruct: '0',
            external_call: '0',
            is_blacklisted: '0',
            is_whitelisted: '0',
            is_anti_whale: '0',
            trading_cooldown: '0',
            sell_tax: '0',
            buy_tax: '0.25',
            holder_count: '500',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    expect(result.buyTax).toBeCloseTo(0.25);
    const highBuyTax = result.risks.find(r => r.type === 'HIGH_BUY_TAX');
    expect(highBuyTax).toBeDefined();
  });

  test('detects low-severity risks (whitelist, anti-whale, cooldown)', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '0',
            is_open_source: '1',
            is_proxy: '0',
            is_mintable: '0',
            can_take_back_ownership: '0',
            hidden_owner: '0',
            selfdestruct: '0',
            external_call: '0',
            is_blacklisted: '0',
            is_whitelisted: '1',
            is_anti_whale: '1',
            trading_cooldown: '1',
            sell_tax: '0',
            buy_tax: '0',
            holder_count: '500',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    expect(result.risks).toHaveLength(3);
    expect(result.riskScore).toBe(15); // 3 * 5
    const types = result.risks.map(r => r.type);
    expect(types).toContain('WHITELIST');
    expect(types).toContain('ANTI_WHALE');
    expect(types).toContain('COOLDOWN');
  });

  test('returns error when token not found in GoPlus', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { result: {} },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Token not found in GoPlus');
  });

  test('returns error on API failure', async () => {
    mockAxios.get.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
  });

  test('calls GoPlus with correct URL and params', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '0',
            is_open_source: '1',
            sell_tax: '0',
            buy_tax: '0',
            holder_count: '100',
          },
        },
      },
    });

    await checkTokenSafety(tokenAddr);

    expect(mockAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/token_security/8453'),
      expect.objectContaining({
        params: { contract_addresses: tokenAddr },
        timeout: 8000,
      })
    );
  });

  test('returns correct metadata fields', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: {
        result: {
          [tokenAddr.toLowerCase()]: {
            is_honeypot: '0',
            is_open_source: '1',
            is_proxy: '0',
            is_mintable: '0',
            can_take_back_ownership: '0',
            hidden_owner: '0',
            selfdestruct: '0',
            external_call: '0',
            is_blacklisted: '0',
            is_whitelisted: '0',
            is_anti_whale: '0',
            trading_cooldown: '0',
            sell_tax: '0.02',
            buy_tax: '0.01',
            holder_count: '2500',
            total_supply: '1000000000000',
            owner_address: '0xOWNER',
            creator_address: '0xCREATOR',
          },
        },
      },
    });

    const result = await checkTokenSafety(tokenAddr);

    expect(result.success).toBe(true);
    expect(result.holderCount).toBe(2500);
    expect(result.totalSupply).toBe('1000000000000');
    expect(result.ownerAddress).toBe('0xOWNER');
    expect(result.creatorAddress).toBe('0xCREATOR');
  });
});
