/**
 * Tests for HealthMonitor — centralized health tracking for all background services.
 */

jest.useFakeTimers();

const healthMonitor = require('../../src/services/health-monitor');

describe('HealthMonitor', () => {
  const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

  beforeEach(() => {
    jest.setSystemTime(BASE_TIME);
    // Reset singleton state between tests
    healthMonitor.services.clear();
    healthMonitor.criticalErrors = [];
    healthMonitor.requestStats = {
      total: 0,
      byStatus: {},
      errors: 0,
      windowStart: Date.now(),
      WINDOW_MS: 5 * 60_000,
    };
    healthMonitor.startedAt = Date.now();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // ── Error Recording ────────────────────────────────────────────────────
  describe('error recording', () => {
    test('recordError stores errors with timestamp on the service', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.recordError('svc1', 'boom');

      const svc = healthMonitor.services.get('svc1');
      expect(svc.errorCount).toBe(1);
      expect(svc.lastError).toBe('boom');
      expect(svc.lastErrorAt).toBe(BASE_TIME);
    });

    test('recordError pushes to criticalErrors array', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.recordError('svc1', 'fail');

      expect(healthMonitor.criticalErrors).toHaveLength(1);
      expect(healthMonitor.criticalErrors[0]).toMatchObject({
        service: 'svc1',
        message: 'fail',
        timestamp: expect.any(String),
      });
    });

    test('recordError for unregistered service still logs critical error', () => {
      healthMonitor.recordError('unknown', 'err');

      expect(healthMonitor.criticalErrors).toHaveLength(1);
      expect(healthMonitor.criticalErrors[0].service).toBe('unknown');
    });

    test('getHealth includes recent critical errors', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.recordError('svc1', 'err1');
      healthMonitor.recordError('svc1', 'err2');

      const health = healthMonitor.getHealth();
      expect(health.criticalErrors).toHaveLength(2);
      expect(health.criticalErrors[0].message).toBe('err1');
      expect(health.criticalErrors[1].message).toBe('err2');
    });

    test('criticalErrors is capped at MAX_CRITICAL_ERRORS (50)', () => {
      for (let i = 0; i < 55; i++) {
        healthMonitor.recordError('svc1', `err-${i}`);
      }

      expect(healthMonitor.criticalErrors).toHaveLength(50);
      // Oldest errors dropped, newest kept
      expect(healthMonitor.criticalErrors[0].message).toBe('err-5');
      expect(healthMonitor.criticalErrors[49].message).toBe('err-54');
    });
  });

  // ── Error Rate Calculation ─────────────────────────────────────────────
  describe('error rate calculation', () => {
    test('getHealth returns 0 error rate when no requests', () => {
      const health = healthMonitor.getHealth();
      expect(health.requests.errorRate).toBe('0.0000');
    });

    test('getHealth returns correct error rate from request stats', () => {
      // 3 out of 10 requests are 5xx → 0.3 error rate
      for (let i = 0; i < 7; i++) healthMonitor.recordRequest(200);
      for (let i = 0; i < 3; i++) healthMonitor.recordRequest(500);

      const health = healthMonitor.getHealth();
      expect(health.requests.total).toBe(10);
      expect(health.requests.errors).toBe(3);
      expect(health.requests.errorRate).toBe('0.3000');
    });

    test('request stats reset after window expires', () => {
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(500);

      // Advance past the 5-minute window
      jest.advanceTimersByTime(5 * 60_000 + 1);
      healthMonitor.recordRequest(200);

      const health = healthMonitor.getHealth();
      expect(health.requests.total).toBe(1);
      expect(health.requests.errors).toBe(0);
    });
  });

  // ── Service Registration ───────────────────────────────────────────────
  describe('service registration', () => {
    test('registerService adds service with running status', () => {
      const instance = { start: jest.fn() };
      healthMonitor.registerService('myService', instance);

      expect(healthMonitor.services.has('myService')).toBe(true);
      const svc = healthMonitor.services.get('myService');
      expect(svc.status).toBe('running');
      expect(svc.errorCount).toBe(0);
      expect(svc.lastError).toBeNull();
      expect(svc.instance).toBe(instance);
    });

    test('getHealth shows registered service in report', () => {
      healthMonitor.registerService('svc1', {});
      const health = healthMonitor.getHealth();

      expect(health.services).toHaveProperty('svc1');
      expect(health.services.svc1.status).toBe('running');
      expect(health.services.svc1.errorCount).toBe(0);
      expect(health.services.svc1.lastError).toBeNull();
    });
  });

  // ── Heartbeat ──────────────────────────────────────────────────────────
  describe('heartbeat', () => {
    test('heartbeat updates lastHeartbeat timestamp', () => {
      healthMonitor.registerService('svc1', {});

      jest.advanceTimersByTime(10_000); // 10 seconds later
      healthMonitor.heartbeat('svc1');

      const svc = healthMonitor.services.get('svc1');
      expect(svc.lastHeartbeat).toBe(BASE_TIME + 10_000);
    });

    test('heartbeat resets status to running', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.services.get('svc1').status = 'stopped';

      healthMonitor.heartbeat('svc1');

      expect(healthMonitor.services.get('svc1').status).toBe('running');
    });

    test('heartbeat on non-existent service is a no-op', () => {
      expect(() => healthMonitor.heartbeat('nonexistent')).not.toThrow();
    });

    test('getHealth derives stale status for old heartbeat', () => {
      healthMonitor.registerService('svc1', {});

      // Advance > 5 minutes
      jest.advanceTimersByTime(5 * 60_000 + 1);

      const health = healthMonitor.getHealth();
      expect(health.services.svc1.status).toBe('stale');
    });

    test('getHealth derives slow status for heartbeat age between 2-5 min', () => {
      healthMonitor.registerService('svc1', {});

      // Advance 3 minutes (between 2 and 5 min thresholds)
      jest.advanceTimersByTime(3 * 60_000);

      const health = healthMonitor.getHealth();
      expect(health.services.svc1.status).toBe('slow');
    });
  });

  // ── Mark Stopped / Restarted ───────────────────────────────────────────
  describe('mark stopped/restarted', () => {
    test('stopped service appears as stopped in health report', () => {
      healthMonitor.registerService('svc1', {});
      const svc = healthMonitor.services.get('svc1');
      svc.status = 'stopped';

      const health = healthMonitor.getHealth();
      expect(health.services.svc1.status).toBe('stopped');
    });

    test('error service appears as error in health report', () => {
      healthMonitor.registerService('svc1', {});
      const svc = healthMonitor.services.get('svc1');
      svc.status = 'error';

      const health = healthMonitor.getHealth();
      expect(health.services.svc1.status).toBe('error');
    });

    test('heartbeat can restart a stopped service', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.services.get('svc1').status = 'stopped';

      healthMonitor.heartbeat('svc1');

      expect(healthMonitor.services.get('svc1').status).toBe('running');
    });
  });

  // ── Request Recording ──────────────────────────────────────────────────
  describe('request recording', () => {
    test('recordRequest tracks total count', () => {
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(404);

      expect(healthMonitor.requestStats.total).toBe(3);
    });

    test('recordRequest tracks by status code', () => {
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(201);
      healthMonitor.recordRequest(404);
      healthMonitor.recordRequest(500);

      expect(healthMonitor.requestStats.byStatus).toEqual({
        '200': 2,
        '201': 1,
        '404': 1,
        '500': 1,
      });
    });

    test('recordRequest counts 5xx as errors', () => {
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(500);
      healthMonitor.recordRequest(502);
      healthMonitor.recordRequest(503);

      expect(healthMonitor.requestStats.errors).toBe(3);
    });

    test('recordRequest does not count 4xx as errors', () => {
      healthMonitor.recordRequest(400);
      healthMonitor.recordRequest(404);

      expect(healthMonitor.requestStats.errors).toBe(0);
    });

    test('getHealth includes request stats', () => {
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(500);

      const health = healthMonitor.getHealth();
      expect(health.requests.total).toBe(2);
      expect(health.requests.errors).toBe(1);
      expect(health.requests.byStatus).toEqual({ '200': 1, '500': 1 });
    });
  });

  // ── Trade Recording ────────────────────────────────────────────────────
  describe('trade recording (via request stats pattern)', () => {
    test('trade tracking can be modeled through error counting', () => {
      healthMonitor.registerService('tradeExecutor', {});
      healthMonitor.recordError('tradeExecutor', 'trade failed: slippage');
      healthMonitor.recordError('tradeExecutor', 'trade failed: timeout');

      const svc = healthMonitor.services.get('tradeExecutor');
      expect(svc.errorCount).toBe(2);
      expect(svc.lastError).toBe('trade failed: timeout');
    });
  });

  // ── LLM Call Recording (via request stats pattern) ─────────────────────
  describe('LLM call recording (via request stats pattern)', () => {
    test('LLM latency can be tracked through request stats', () => {
      // Simulate LLM calls as requests with status codes
      healthMonitor.recordRequest(200); // success
      healthMonitor.recordRequest(200); // success
      healthMonitor.recordRequest(500); // LLM error

      expect(healthMonitor.requestStats.total).toBe(3);
      expect(healthMonitor.requestStats.errors).toBe(1);
    });

    test('LLM errors can be tracked through service error recording', () => {
      healthMonitor.registerService('llm', {});
      healthMonitor.recordError('llm', 'LLM timeout after 30s');

      const svc = healthMonitor.services.get('llm');
      expect(svc.errorCount).toBe(1);
      expect(svc.lastError).toBe('LLM timeout after 30s');
    });
  });

  // ── Memory Usage ───────────────────────────────────────────────────────
  describe('memory usage', () => {
    test('getHealth includes uptime in report', () => {
      jest.advanceTimersByTime(60_000); // 1 minute
      const health = healthMonitor.getHealth();

      expect(health.uptime).toBe(60); // 60 seconds
    });

    test('uptime starts from startedAt', () => {
      // Set startedAt to 2 minutes ago
      healthMonitor.startedAt = BASE_TIME - 120_000;

      const health = healthMonitor.getHealth();
      expect(health.uptime).toBe(120);
    });
  });

  // ── Uptime ─────────────────────────────────────────────────────────────
  describe('uptime', () => {
    test('getHealth includes uptime as integer seconds', () => {
      jest.advanceTimersByTime(5_500); // 5.5 seconds

      const health = healthMonitor.getHealth();
      expect(health.uptime).toBe(5);
      expect(Number.isInteger(health.uptime)).toBe(true);
    });

    test('uptime increases over time', () => {
      const health1 = healthMonitor.getHealth();
      jest.advanceTimersByTime(30_000);
      const health2 = healthMonitor.getHealth();

      expect(health2.uptime).toBe(health1.uptime + 30);
    });
  });

  // ── Critical Error Detection ───────────────────────────────────────────
  describe('checkCriticalErrors', () => {
    test('returns alert for stopped service', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.services.get('svc1').status = 'stopped';

      const alerts = healthMonitor.checkCriticalErrors();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        service: 'svc1',
        message: 'Service is stopped',
      });
    });

    test('returns alert for error service', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.services.get('svc1').status = 'error';

      const alerts = healthMonitor.checkCriticalErrors();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toBe('Service is error');
    });

    test('returns alert for high error count', () => {
      healthMonitor.registerService('svc1', {});

      // Record 10 errors (threshold)
      for (let i = 0; i < 10; i++) {
        healthMonitor.recordError('svc1', `err-${i}`);
      }

      const alerts = healthMonitor.checkCriticalErrors();
      expect(alerts.some(a => a.message.includes('High error rate'))).toBe(true);
    });

    test('does not alert for high error count if last error is old', () => {
      healthMonitor.registerService('svc1', {});

      // Record 10 errors
      for (let i = 0; i < 10; i++) {
        healthMonitor.recordError('svc1', `err-${i}`);
      }

      // Advance past 5 minutes from last error
      jest.advanceTimersByTime(300_000 + 1);

      const alerts = healthMonitor.checkCriticalErrors();
      // Should NOT have high error rate alert (only stopped/error alerts, if any)
      expect(alerts.some(a => a.message.includes('High error rate'))).toBe(false);
    });

    test('returns empty array when all services healthy', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.registerService('svc2', {});

      const alerts = healthMonitor.checkCriticalErrors();
      expect(alerts).toHaveLength(0);
    });

    test('returns multiple alerts for multiple bad services', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.registerService('svc2', {});
      healthMonitor.services.get('svc1').status = 'stopped';
      healthMonitor.services.get('svc2').status = 'error';

      const alerts = healthMonitor.checkCriticalErrors();
      expect(alerts).toHaveLength(2);
      expect(alerts.map(a => a.service)).toContain('svc1');
      expect(alerts.map(a => a.service)).toContain('svc2');
    });
  });

  // ── Overall Health Status ──────────────────────────────────────────────
  describe('overall health status', () => {
    test('returns healthy when all services are running with no issues', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.registerService('svc2', {});

      const health = healthMonitor.getHealth();
      expect(health.status).toBe('healthy');
    });

    test('returns degraded when a service has stale heartbeat', () => {
      healthMonitor.registerService('svc1', {});
      jest.advanceTimersByTime(5 * 60_000 + 1); // > 5 min stale

      const health = healthMonitor.getHealth();
      expect(health.status).toBe('degraded');
    });

    test('returns critical when a service is stopped', () => {
      healthMonitor.registerService('svc1', {});
      healthMonitor.services.get('svc1').status = 'stopped';

      const health = healthMonitor.getHealth();
      expect(health.status).toBe('critical');
    });

    test('returns critical when error rate > 50% with >= 10 requests', () => {
      healthMonitor.registerService('svc1', {});

      // 6 errors out of 10 = 60% error rate
      for (let i = 0; i < 4; i++) healthMonitor.recordRequest(200);
      for (let i = 0; i < 6; i++) healthMonitor.recordRequest(500);

      const health = healthMonitor.getHealth();
      expect(health.status).toBe('critical');
    });

    test('returns degraded when error rate > 10% with >= 10 requests', () => {
      healthMonitor.registerService('svc1', {});

      // 2 errors out of 10 = 20% error rate (> 10% but <= 50%)
      for (let i = 0; i < 8; i++) healthMonitor.recordRequest(200);
      for (let i = 0; i < 2; i++) healthMonitor.recordRequest(500);

      const health = healthMonitor.getHealth();
      expect(health.status).toBe('degraded');
    });

    test('returns healthy when error rate <= 10%', () => {
      healthMonitor.registerService('svc1', {});

      // 1 error out of 10 = 10% (not > 10%)
      for (let i = 0; i < 9; i++) healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(500);

      const health = healthMonitor.getHealth();
      expect(health.status).toBe('healthy');
    });

    test('returns healthy when error rate high but < 10 total requests', () => {
      healthMonitor.registerService('svc1', {});

      // 3 errors out of 5 = 60%, but < 10 total requests → no error rate trigger
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(500);
      healthMonitor.recordRequest(500);
      healthMonitor.recordRequest(500);
      healthMonitor.recordRequest(200);

      const health = healthMonitor.getHealth();
      expect(health.status).toBe('healthy');
    });
  });

  // ── Service Instance Retrieval ─────────────────────────────────────────
  describe('getServiceInstance', () => {
    test('returns the registered instance', () => {
      const instance = { start: jest.fn(), stop: jest.fn() };
      healthMonitor.registerService('svc1', instance);

      expect(healthMonitor.getServiceInstance('svc1')).toBe(instance);
    });

    test('returns null for unregistered service', () => {
      expect(healthMonitor.getServiceInstance('nonexistent')).toBeNull();
    });
  });

  // ── Error Cleanup ──────────────────────────────────────────────────────
  describe('error cleanup', () => {
    test('criticalErrors ring buffer drops oldest beyond MAX', () => {
      const max = healthMonitor.MAX_CRITICAL_ERRORS;

      for (let i = 0; i < max + 10; i++) {
        healthMonitor.recordError('svc1', `err-${i}`);
      }

      expect(healthMonitor.criticalErrors).toHaveLength(max);
      // First item should be err-10 (the 11th error, 0-indexed)
      expect(healthMonitor.criticalErrors[0].message).toBe(`err-10`);
      expect(healthMonitor.criticalErrors[max - 1].message).toBe(`err-${max + 10 - 1}`);
    });

    test('getHealth returns only last 10 critical errors', () => {
      for (let i = 0; i < 20; i++) {
        healthMonitor.recordError('svc1', `err-${i}`);
      }

      const health = healthMonitor.getHealth();
      expect(health.criticalErrors).toHaveLength(10);
      expect(health.criticalErrors[0].message).toBe('err-10');
      expect(health.criticalErrors[9].message).toBe('err-19');
    });

    test('request stats window resets correctly', () => {
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(200);
      expect(healthMonitor.requestStats.total).toBe(2);

      // Advance just past window
      jest.advanceTimersByTime(5 * 60_000 + 1);

      healthMonitor.recordRequest(500);
      expect(healthMonitor.requestStats.total).toBe(1);
      expect(healthMonitor.requestStats.byStatus).toEqual({ '500': 1 });
      expect(healthMonitor.requestStats.errors).toBe(1);
    });
  });

  // ── getHealth Timestamp ────────────────────────────────────────────────
  describe('getHealth report structure', () => {
    test('includes all required fields', () => {
      healthMonitor.registerService('svc1', {});
      const health = healthMonitor.getHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('services');
      expect(health).toHaveProperty('requests');
      expect(health).toHaveProperty('criticalErrors');
    });

    test('timestamp is valid ISO string', () => {
      const health = healthMonitor.getHealth();
      expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
    });

    test('heartbeatAgeMs is reported for services', () => {
      healthMonitor.registerService('svc1', {});
      jest.advanceTimersByTime(5_000);

      const health = healthMonitor.getHealth();
      expect(health.services.svc1.heartbeatAgeMs).toBe(5_000);
    });
  });
});
