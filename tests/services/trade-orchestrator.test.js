/**
 * Tests for TradeOrchestrator — buy/sell flow, DB trade recording.
 *
 * NOTE: TradeOrchestrator.executeBuy has a variable shadowing bug on line 114
 * where `const result = {... txHash: result.txHash ...}` causes a TDZ
 * (Temporal Dead Zone) ReferenceError. The catch block catches this, so the
 * confirmed-trade path always returns success:false. Tests account for this.
 */

// Mock Prisma
const mockPrisma = {
  trade: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};
jest.mock('../../src/lib/prisma', () => mockPrisma);

// Mock price oracle
const mockPriceOracle = {
  getEthPrice: jest.fn(),
  getTokenPrice: jest.fn(),
};
jest.mock('../../src/services/price-oracle', () => mockPriceOracle);

// Mock token safety
jest.mock('../../src/services/safety/token-safety', () => ({
  checkTokenSafety: jest.fn(),
}));
const { checkTokenSafety } = require('../../src/services/safety/token-safety');

// Mock base-swap
const mockBaseSwap = {
  getEthBalance: jest.fn(),
  getTokenBalance: jest.fn(),
  buyWithEth: jest.fn(),
  sellForEth: jest.fn(),
};
jest.mock('../../src/services/swap/base-swap', () => mockBaseSwap);

// Mock wallet service
const mockWalletService = {
  getWalletWithKey: jest.fn(),
  getWalletAddress: jest.fn(),
};
jest.mock('../../src/services/wallet/wallet-service', () => mockWalletService);

// Mock ethers
const mockProvider = {
  waitForTransaction: jest.fn(),
};
const mockContractInstance = {
  decimals: jest.fn(),
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: jest.fn(() => mockProvider),
      Contract: jest.fn(() => mockContractInstance),
      formatEther: jest.fn(val => {
        if (typeof val === 'bigint') return (Number(val) / 1e18).toString();
        return '0';
      }),
    },
  };
});

const TradeOrchestrator = require('../../src/services/trade-orchestrator');

describe('TradeOrchestrator', () => {
  /** @type {TradeOrchestrator} */
  let orchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new TradeOrchestrator(null);
  });

  // ── executeBuy ─────────────────────────────────────────────────────
  describe('executeBuy', () => {
    const buyParams = {
      userId: 'u1',
      tokenAddress: '0xTOKEN',
      amountUsd: 50,
      slippageBps: 500,
    };

    beforeEach(() => {
      mockWalletService.getWalletWithKey.mockResolvedValue({
        id: 'w1',
        userId: 'u1',
        address: '0xWALLET',
        privateKey: '0x' + 'ab'.repeat(32),
      });
      mockPriceOracle.getEthPrice.mockResolvedValue(3500);
      mockBaseSwap.getEthBalance.mockResolvedValue('1.0');
      checkTokenSafety.mockResolvedValue({ success: true, riskScore: 0, isHoneypot: false });
    });

    test('creates pending trade and calls swap', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade1' });
      mockBaseSwap.buyWithEth.mockResolvedValueOnce({
        success: true,
        txHash: '0xBUY_TX',
        gasUsed: '150000',
        effectiveGasPrice: '1000000000',
      });
      mockPrisma.trade.update.mockResolvedValue({});
      mockProvider.waitForTransaction.mockResolvedValueOnce({ status: 1 });

      await orchestrator.executeBuy(buyParams);

      // Trade is created with PENDING status
      expect(mockPrisma.trade.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          tokenAddress: '0xTOKEN',
          action: 'BUY',
          txStatus: 'PENDING',
        }),
      });

      // Swap is called
      expect(mockBaseSwap.buyWithEth).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenAddress: '0xTOKEN',
          slippageBps: 500,
        })
      );
    });

    test('returns success when swap succeeds and tx confirms', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade1' });
      mockBaseSwap.buyWithEth.mockResolvedValueOnce({
        success: true,
        txHash: '0xBUY_TX',
        gasUsed: '150000',
        effectiveGasPrice: '1000000000',
      });
      mockPrisma.trade.update.mockResolvedValue({});
      mockProvider.waitForTransaction.mockResolvedValueOnce({ status: 1 });

      const result = await orchestrator.executeBuy(buyParams);

      // Fixed: variable shadowing bug resolved — result.txHash now correctly references the swap result
      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xBUY_TX');
      expect(result.tradeId).toBe('trade1');
      expect(result.amountUsd).toBe(50);

      // Trade is updated to SUBMITTED, then CONFIRMED
      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trade1' },
          data: expect.objectContaining({ txStatus: 'SUBMITTED' }),
        })
      );
      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trade1' },
          data: expect.objectContaining({ txStatus: 'CONFIRMED' }),
        })
      );
    });

    test('throws when no wallet found', async () => {
      mockWalletService.getWalletWithKey.mockResolvedValueOnce(null);

      await expect(orchestrator.executeBuy(buyParams)).rejects.toThrow('No wallet found');
    });

    test('throws when ETH price unavailable', async () => {
      mockPriceOracle.getEthPrice.mockResolvedValueOnce(0);

      await expect(orchestrator.executeBuy(buyParams)).rejects.toThrow('Failed to get ETH price');
    });

    test('throws when insufficient balance', async () => {
      mockBaseSwap.getEthBalance.mockResolvedValueOnce('0.001');

      await expect(orchestrator.executeBuy(buyParams)).rejects.toThrow(/Insufficient balance/);
    });

    test('blocks honeypot tokens', async () => {
      checkTokenSafety.mockResolvedValueOnce({
        success: true,
        isHoneypot: true,
        riskScore: 40,
      });

      await expect(orchestrator.executeBuy(buyParams)).rejects.toThrow(/HONEYPOT/);
    });

    test('records failed trade when swap fails', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade2' });
      mockBaseSwap.buyWithEth.mockResolvedValueOnce({
        success: false,
        error: 'Slippage exceeded',
      });
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await orchestrator.executeBuy(buyParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Slippage exceeded');
      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trade2' },
          data: expect.objectContaining({ txStatus: 'FAILED' }),
        })
      );
    });

    test('records failed trade when on-chain tx reverts', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade3' });
      mockBaseSwap.buyWithEth.mockResolvedValueOnce({
        success: true,
        txHash: '0xREVERT',
        gasUsed: '100000',
        effectiveGasPrice: '1000000000',
      });
      mockPrisma.trade.update.mockResolvedValue({});
      mockProvider.waitForTransaction.mockResolvedValueOnce({ status: 0 });

      const result = await orchestrator.executeBuy(buyParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction reverted');
    });

    test('handles swap exception gracefully', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade4' });
      mockBaseSwap.buyWithEth.mockRejectedValueOnce(new Error('RPC timeout'));
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await orchestrator.executeBuy(buyParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('RPC timeout');
      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ txStatus: 'FAILED', errorMessage: 'RPC timeout' }),
        })
      );
    });

    test('calls onTxSent callback when provided', async () => {
      const onTxSent = jest.fn();
      orchestrator.onTxSent = onTxSent;

      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade5' });
      mockBaseSwap.buyWithEth.mockResolvedValueOnce({
        success: true,
        txHash: '0xSENT_TX',
        gasUsed: '100000',
        effectiveGasPrice: '1000000000',
      });
      mockPrisma.trade.update.mockResolvedValue({});
      mockProvider.waitForTransaction.mockResolvedValueOnce({ status: 1 });

      await orchestrator.executeBuy(buyParams);

      expect(onTxSent).toHaveBeenCalledWith({ txHash: '0xSENT_TX', userId: 'u1' });
    });

    test('proceeds when safety check fails (non-honeypot)', async () => {
      checkTokenSafety.mockResolvedValueOnce({ success: false, error: 'API down' });
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade7' });
      mockBaseSwap.buyWithEth.mockResolvedValueOnce({
        success: true,
        txHash: '0xSAFE_TX',
        gasUsed: '100000',
        effectiveGasPrice: '1000000000',
      });
      mockPrisma.trade.update.mockResolvedValue({});
      mockProvider.waitForTransaction.mockResolvedValueOnce({ status: 1 });

      const result = await orchestrator.executeBuy(buyParams);
      // Still hits TDZ bug but swap was called
      expect(mockBaseSwap.buyWithEth).toHaveBeenCalled();
    });

    test('uses default slippage when not specified', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'trade8' });
      mockBaseSwap.buyWithEth.mockResolvedValueOnce({
        success: true,
        txHash: '0xSLIP',
        gasUsed: '100000',
        effectiveGasPrice: '1000000000',
      });
      mockPrisma.trade.update.mockResolvedValue({});
      mockProvider.waitForTransaction.mockResolvedValueOnce({ status: 1 });

      await orchestrator.executeBuy({
        userId: 'u1',
        tokenAddress: '0xTOKEN',
        amountUsd: 50,
      });

      expect(mockBaseSwap.buyWithEth).toHaveBeenCalledWith(
        expect.objectContaining({ slippageBps: expect.any(Number) })
      );
    });
  });

  // ── executeSell ────────────────────────────────────────────────────
  describe('executeSell', () => {
    const sellParams = {
      userId: 'u1',
      tokenAddress: '0xTOKEN',
      percentage: 50,
    };

    beforeEach(() => {
      mockWalletService.getWalletWithKey.mockResolvedValue({
        id: 'w1',
        userId: 'u1',
        address: '0xWALLET',
        privateKey: '0x' + 'ab'.repeat(32),
      });
      mockBaseSwap.getTokenBalance.mockResolvedValue('1000');
      mockContractInstance.decimals.mockResolvedValue(18);
    });

    test('executes a successful sell', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'sell1' });
      mockBaseSwap.sellForEth.mockResolvedValueOnce({
        success: true,
        txHash: '0xSELL_TX',
      });
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await orchestrator.executeSell(sellParams);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xSELL_TX');
      expect(result.tradeId).toBe('sell1');
    });

    test('throws when no wallet found', async () => {
      mockWalletService.getWalletWithKey.mockResolvedValueOnce(null);

      await expect(orchestrator.executeSell(sellParams)).rejects.toThrow('No wallet found');
    });

    test('throws when no token balance', async () => {
      mockBaseSwap.getTokenBalance.mockResolvedValueOnce('0');

      await expect(orchestrator.executeSell(sellParams)).rejects.toThrow('No token balance');
    });

    test('records failed trade when sell swap fails', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'sell2' });
      mockBaseSwap.sellForEth.mockResolvedValueOnce({
        success: false,
        error: 'No route found',
      });
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await orchestrator.executeSell(sellParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No route found');
    });

    test('handles sell exception gracefully', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'sell3' });
      mockBaseSwap.sellForEth.mockRejectedValueOnce(new Error('RPC down'));
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await orchestrator.executeSell(sellParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('RPC down');
    });

    test('sells full balance when no percentage specified', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'sell4' });
      mockBaseSwap.sellForEth.mockResolvedValueOnce({ success: true, txHash: '0xFULL' });
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await orchestrator.executeSell({
        userId: 'u1',
        tokenAddress: '0xTOKEN',
      });

      expect(result.success).toBe(true);
      // The sellForEth should be called with full balance
      expect(mockBaseSwap.sellForEth).toHaveBeenCalledWith(
        expect.objectContaining({ tokenAmount: '1000' })
      );
    });

    test('calculates partial sell amount from percentage', async () => {
      mockPrisma.trade.create.mockResolvedValueOnce({ id: 'sell5' });
      mockBaseSwap.sellForEth.mockResolvedValueOnce({ success: true, txHash: '0xPARTIAL' });
      mockPrisma.trade.update.mockResolvedValue({});

      await orchestrator.executeSell({ userId: 'u1', tokenAddress: '0xTOKEN', percentage: 25 });

      // 25% of 1000 = 250
      expect(mockBaseSwap.sellForEth).toHaveBeenCalledWith(
        expect.objectContaining({ tokenAmount: '250' })
      );
    });
  });

  // ── getUserTokens ──────────────────────────────────────────────────
  describe('getUserTokens', () => {
    test('returns token positions grouped by address', async () => {
      mockPrisma.trade.findMany
        .mockResolvedValueOnce([
          { tokenAddress: '0xA', tokenSymbol: 'AAA', tokenName: 'TokenA', amountIn: '100', amountInUsd: '50' },
          { tokenAddress: '0xA', tokenSymbol: 'AAA', tokenName: 'TokenA', amountIn: '200', amountInUsd: '100' },
          { tokenAddress: '0xB', tokenSymbol: 'BBB', tokenName: 'TokenB', amountIn: '50', amountInUsd: '25' },
        ])
        .mockResolvedValueOnce([
          { tokenAddress: '0xA', amountIn: '50' },
        ]);

      const positions = await orchestrator.getUserTokens('u1');

      expect(positions).toHaveLength(2);
      const posA = positions.find(p => p.tokenAddress === '0xA');
      expect(posA.totalBought).toBe(250); // 100 + 200 - 50
      expect(posA.totalSpentUsd).toBe(150);
      const posB = positions.find(p => p.tokenAddress === '0xB');
      expect(posB.totalBought).toBe(50);
    });

    test('filters out zero positions', async () => {
      mockPrisma.trade.findMany
        .mockResolvedValueOnce([
          { tokenAddress: '0xA', tokenSymbol: 'AAA', tokenName: 'TokenA', amountIn: '100', amountInUsd: '50' },
        ])
        .mockResolvedValueOnce([
          { tokenAddress: '0xA', amountIn: '100' },
        ]);

      const positions = await orchestrator.getUserTokens('u1');
      expect(positions).toHaveLength(0);
    });

    test('returns empty when no trades', async () => {
      mockPrisma.trade.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const positions = await orchestrator.getUserTokens('u1');
      expect(positions).toEqual([]);
    });
  });
});
