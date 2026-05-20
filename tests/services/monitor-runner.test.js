/**
 * Tests for MonitorRunner — price alerts, limit orders, wallet tracking, DCA.
 */

// Mock Prisma
const mockPrisma = {
  monitor: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};
jest.mock('../../src/lib/prisma', () => mockPrisma);

// Mock price oracle
const mockPriceOracle = {
  getTokenPrice: jest.fn(),
};
jest.mock('../../src/services/price-oracle', () => mockPriceOracle);

// Mock ethers — for wallet tracker provider
const mockProvider = {
  getBlockNumber: jest.fn(),
  getLogs: jest.fn(),
  getTransaction: jest.fn(),
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: jest.fn(() => mockProvider),
      zeroPadValue: actual.ethers.zeroPadValue,
      getAddress: actual.ethers.getAddress,
    },
  };
});

const MonitorRunner = require('../../src/services/monitor-runner');

describe('MonitorRunner', () => {
  /** @type {MonitorRunner} */
  let runner;
  let mockTradeOrchestrator;
  let mockNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockTradeOrchestrator = {
      executeBuy: jest.fn(),
      executeSell: jest.fn(),
    };
    mockNotificationService = {
      sendMessage: jest.fn(),
    };
    runner = new MonitorRunner(mockTradeOrchestrator, mockNotificationService);
  });

  afterEach(() => {
    runner.stop();
    jest.useRealTimers();
  });

  // ── start / stop ───────────────────────────────────────────────────
  describe('start / stop', () => {
    test('starts and sets running flag', async () => {
      await runner.start();
      expect(runner.running).toBe(true);
    });

    test('stops and clears interval', async () => {
      await runner.start();
      runner.stop();
      expect(runner.running).toBe(false);
    });

    test('does not start twice', async () => {
      await runner.start();
      await runner.start(); // should be a no-op
      expect(runner.running).toBe(true);
    });
  });

  // ── _tick — expired monitors ───────────────────────────────────────
  describe('_tick — expired monitors', () => {
    test('cancels expired monitors', async () => {
      const expiredDate = new Date(Date.now() - 10000);
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'm1',
          type: 'PRICE_ALERT',
          status: 'WATCHING',
          expiresAt: expiredDate,
          params: {},
          userId: 'u1',
          user: { id: 'u1', telegramId: 'tg1' },
        },
      ]);
      mockPrisma.monitor.update.mockResolvedValue({});

      await runner._tick();

      expect(mockPrisma.monitor.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { status: 'CANCELLED' },
      });
    });

    test('skips monitors with nextRunAt in the future', async () => {
      const futureDate = new Date(Date.now() + 100000);
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'm2',
          type: 'DCA',
          status: 'WATCHING',
          expiresAt: null,
          nextRunAt: futureDate,
          params: {},
          userId: 'u1',
          user: { id: 'u1', telegramId: 'tg1' },
        },
      ]);

      await runner._tick();

      // Should not attempt to process DCA
      expect(mockTradeOrchestrator.executeBuy).not.toHaveBeenCalled();
    });
  });

  // ── PRICE_ALERT ────────────────────────────────────────────────────
  describe('PRICE_ALERT', () => {
    const baseMonitor = {
      id: 'alert1',
      type: 'PRICE_ALERT',
      status: 'WATCHING',
      expiresAt: null,
      userId: 'u1',
      params: {
        tokenAddress: '0xTOKEN',
        condition: 'above',
        targetPriceUsd: 0.01,
      },
      user: { id: 'u1', telegramId: 'tg123' },
    };

    test('triggers alert when price goes above target', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([{ ...baseMonitor }]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.015 });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert1' },
          data: expect.objectContaining({ status: 'TRIGGERED' }),
        })
      );
      expect(mockNotificationService.sendMessage).toHaveBeenCalledWith(
        'tg123',
        expect.stringContaining('Price Alert')
      );
    });

    test('does not trigger when price below target (above condition)', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([{ ...baseMonitor }]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.005 });
      mockPrisma.monitor.update.mockResolvedValue({});

      await runner._tick();

      // Should update lastCheckedAt but NOT trigger
      expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'alert1' },
          data: expect.objectContaining({ lastCheckedAt: expect.any(Date) }),
        })
      );
      expect(mockNotificationService.sendMessage).not.toHaveBeenCalled();
    });

    test('triggers alert when price goes below target', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          ...baseMonitor,
          params: { tokenAddress: '0xTOKEN', condition: 'below', targetPriceUsd: 0.01 },
        },
      ]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.005 });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'TRIGGERED' }),
        })
      );
    });

    test('does not trigger when price data is null', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([{ ...baseMonitor }]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce(null);
      mockPrisma.monitor.update.mockResolvedValue({});

      await runner._tick();

      expect(mockNotificationService.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── LIMIT_ORDER ────────────────────────────────────────────────────
  describe('LIMIT_ORDER', () => {
    test('executes buy limit order when price drops to target', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'limit1',
          type: 'LIMIT_ORDER',
          status: 'WATCHING',
          expiresAt: null,
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            side: 'buy',
            targetPriceUsd: 0.005,
            amountUsd: 25,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.004 });
      mockTradeOrchestrator.executeBuy.mockResolvedValueOnce({ success: true });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      expect(mockTradeOrchestrator.executeBuy).toHaveBeenCalledWith({
        userId: 'u1',
        tokenAddress: '0xTOKEN',
        amountUsd: 25,
        slippageBps: expect.any(Number),
      });
      expect(mockNotificationService.sendMessage).toHaveBeenCalledWith(
        'tg123',
        expect.stringContaining('Limit Order Executed')
      );
    });

    test('executes sell limit order when price rises to target', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'limit2',
          type: 'LIMIT_ORDER',
          status: 'WATCHING',
          expiresAt: null,
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            side: 'sell',
            targetPriceUsd: 0.05,
            percentage: 100,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.06 });
      mockTradeOrchestrator.executeSell.mockResolvedValueOnce({ success: true });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      expect(mockTradeOrchestrator.executeSell).toHaveBeenCalledWith({
        userId: 'u1',
        tokenAddress: '0xTOKEN',
        percentage: 100,
      });
    });

    test('does not execute when price not at target', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'limit3',
          type: 'LIMIT_ORDER',
          status: 'WATCHING',
          expiresAt: null,
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            side: 'buy',
            targetPriceUsd: 0.001,
            amountUsd: 10,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.01 });
      mockPrisma.monitor.update.mockResolvedValue({});

      await runner._tick();

      expect(mockTradeOrchestrator.executeBuy).not.toHaveBeenCalled();
    });

    test('handles limit order execution failure gracefully', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'limit4',
          type: 'LIMIT_ORDER',
          status: 'WATCHING',
          expiresAt: null,
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            side: 'buy',
            targetPriceUsd: 0.01,
            amountUsd: 10,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.005 });
      mockTradeOrchestrator.executeBuy.mockRejectedValueOnce(new Error('Swap failed'));
      mockPrisma.monitor.update.mockResolvedValue({});

      // Should not throw — error is caught internally
      await runner._tick();
    });
  });

  // ── DCA ────────────────────────────────────────────────────────────
  describe('DCA', () => {
    test('executes DCA buy and increments counter', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'dca1',
          type: 'DCA',
          status: 'WATCHING',
          expiresAt: null,
          nextRunAt: new Date(Date.now() - 1000),
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            amountUsd: 10,
            intervalSeconds: 3600,
            totalExecutions: 5,
            executedCount: 2,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockTradeOrchestrator.executeBuy.mockResolvedValueOnce({ success: true });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      expect(mockTradeOrchestrator.executeBuy).toHaveBeenCalled();
      // The DCA handler updates params with incremented executedCount
      expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dca1' },
          data: expect.objectContaining({
            params: expect.objectContaining({ executedCount: 3 }),
            status: 'WATCHING',
          }),
        })
      );
    });

    test('marks DCA as TRIGGERED when all executions complete', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'dca2',
          type: 'DCA',
          status: 'WATCHING',
          expiresAt: null,
          nextRunAt: new Date(Date.now() - 1000),
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            amountUsd: 10,
            intervalSeconds: 3600,
            totalExecutions: 3,
            executedCount: 2,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockTradeOrchestrator.executeBuy.mockResolvedValueOnce({ success: true });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      // DCA handler should set status to TRIGGERED
      expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dca2' },
          data: expect.objectContaining({
            params: expect.objectContaining({ executedCount: 3 }),
            status: 'TRIGGERED',
          }),
        })
      );
    });

    test('marks already-completed DCA as TRIGGERED without executing', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'dca3',
          type: 'DCA',
          status: 'WATCHING',
          expiresAt: null,
          nextRunAt: new Date(Date.now() - 1000),
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            amountUsd: 10,
            intervalSeconds: 3600,
            totalExecutions: 3,
            executedCount: 3,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockPrisma.monitor.update.mockResolvedValue({});

      await runner._tick();

      expect(mockTradeOrchestrator.executeBuy).not.toHaveBeenCalled();
      expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dca3' },
          data: expect.objectContaining({ status: 'TRIGGERED' }),
        })
      );
    });

    test('handles DCA execution failure gracefully', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'dca4',
          type: 'DCA',
          status: 'WATCHING',
          expiresAt: null,
          nextRunAt: new Date(Date.now() - 1000),
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            amountUsd: 10,
            intervalSeconds: 3600,
            totalExecutions: 5,
            executedCount: 1,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockTradeOrchestrator.executeBuy.mockRejectedValueOnce(new Error('Swap failed'));
      mockPrisma.monitor.update.mockResolvedValue({});

      // Should not throw
      await runner._tick();

      // Monitor should still be updated with lastCheckedAt
      expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dca4' },
          data: expect.objectContaining({ lastCheckedAt: expect.any(Date) }),
        })
      );
    });

    test('sets nextRunAt for non-final DCA executions', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'dca5',
          type: 'DCA',
          status: 'WATCHING',
          expiresAt: null,
          nextRunAt: new Date(Date.now() - 1000),
          userId: 'u1',
          params: {
            tokenAddress: '0xTOKEN',
            amountUsd: 10,
            intervalSeconds: 7200,
            totalExecutions: 5,
            executedCount: 0,
          },
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockTradeOrchestrator.executeBuy.mockResolvedValueOnce({ success: true });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      // Should set nextRunAt for the next execution
      const updateCall = mockPrisma.monitor.update.mock.calls.find(
        c => c[0].where.id === 'dca5'
      );
      expect(updateCall[0].data.nextRunAt).toBeDefined();
      expect(updateCall[0].data.status).toBe('WATCHING');
    });
  });

  // ── _notify ────────────────────────────────────────────────────────
  describe('_notify', () => {
    test('sends message via notification service', async () => {
      mockNotificationService.sendMessage.mockResolvedValueOnce({});

      await runner._notify('tg123', 'u1', 'Hello!');

      expect(mockNotificationService.sendMessage).toHaveBeenCalledWith('tg123', 'Hello!');
    });

    test('handles notification failure gracefully', async () => {
      mockNotificationService.sendMessage.mockRejectedValueOnce(new Error('blocked'));

      // Should not throw
      await runner._notify('tg123', 'u1', 'Hello!');
    });

    test('does nothing when no notification service', async () => {
      const noNotifRunner = new MonitorRunner(mockTradeOrchestrator, null);
      await noNotifRunner._notify('tg123', 'u1', 'Hello!');
      // No error thrown, no call made
    });

    test('does nothing when no telegramId', async () => {
      await runner._notify(null, 'u1', 'Hello!');
      expect(mockNotificationService.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ── String params parsing ──────────────────────────────────────────
  describe('string params parsing', () => {
    test('parses JSON string params for PRICE_ALERT', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'alert_str',
          type: 'PRICE_ALERT',
          status: 'WATCHING',
          expiresAt: null,
          userId: 'u1',
          params: JSON.stringify({
            tokenAddress: '0xTOKEN',
            condition: 'above',
            targetPriceUsd: 0.01,
          }),
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockPriceOracle.getTokenPrice.mockResolvedValueOnce({ usd: 0.02 });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      expect(mockNotificationService.sendMessage).toHaveBeenCalled();
    });

    test('parses JSON string params for DCA', async () => {
      mockPrisma.monitor.findMany.mockResolvedValueOnce([
        {
          id: 'dca_str',
          type: 'DCA',
          status: 'WATCHING',
          expiresAt: null,
          nextRunAt: new Date(Date.now() - 1000),
          userId: 'u1',
          params: JSON.stringify({
            tokenAddress: '0xTOKEN',
            amountUsd: 5,
            intervalSeconds: 86400,
            totalExecutions: 1,
            executedCount: 0,
          }),
          user: { id: 'u1', telegramId: 'tg123' },
        },
      ]);
      mockTradeOrchestrator.executeBuy.mockResolvedValueOnce({ success: true });
      mockPrisma.monitor.update.mockResolvedValue({});
      mockNotificationService.sendMessage.mockResolvedValue({});

      await runner._tick();

      expect(mockTradeOrchestrator.executeBuy).toHaveBeenCalled();
    });
  });
});
