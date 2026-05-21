/**
 * HealthMonitor — centralized health tracking for all background services.
 * Tracks heartbeats, errors, request stats, and provides self-healing support.
 */

const logger = require('../utils/logger');

class HealthMonitor {
  constructor() {
    /** @type {Map<string, { status: string, lastHeartbeat: number, errorCount: number, lastError: string|null, instance: object|null }>} */
    this.services = new Map();

    // Request tracking (rolling 5-minute window)
    this.requestStats = {
      total: 0,
      byStatus: {},       // { '200': count, '500': count, ... }
      errors: 0,
      windowStart: Date.now(),
      WINDOW_MS: 5 * 60_000,
    };

    // Critical errors log (ring buffer, last 50)
    this.criticalErrors = [];
    this.MAX_CRITICAL_ERRORS = 50;

    // Process start time
    this.startedAt = Date.now();
  }

  // ── Service Registration ─────────────────────────────────────────────

  /**
   * Register a background service for monitoring.
   * @param {string} name
   * @param {object} instance - The service instance (needs .start() for restart)
   */
  registerService(name, instance) {
    this.services.set(name, {
      status: 'running',
      lastHeartbeat: Date.now(),
      errorCount: 0,
      lastError: null,
      instance,
    });
    logger.debug('HealthMonitor: registered service', { name });
  }

  /**
   * Get the raw service instance for a given name.
   * @param {string} name
   * @returns {object|null}
   */
  getServiceInstance(name) {
    const svc = this.services.get(name);
    return svc ? svc.instance : null;
  }

  // ── Heartbeats ───────────────────────────────────────────────────────

  /**
   * Record a heartbeat for a service (call periodically from each service).
   * @param {string} name
   */
  heartbeat(name) {
    const svc = this.services.get(name);
    if (svc) {
      svc.lastHeartbeat = Date.now();
      svc.status = 'running';
    }
  }

  // ── Error Recording ──────────────────────────────────────────────────

  /**
   * Record an error for a specific service.
   * @param {string} name
   * @param {string} message
   */
  recordError(name, message) {
    const svc = this.services.get(name);
    if (svc) {
      svc.errorCount++;
      svc.lastError = message;
      svc.lastErrorAt = Date.now();
    }

    this.criticalErrors.push({
      service: name,
      message,
      timestamp: new Date().toISOString(),
    });
    if (this.criticalErrors.length > this.MAX_CRITICAL_ERRORS) {
      this.criticalErrors.shift();
    }
  }

  // ── Request Tracking ─────────────────────────────────────────────────

  /**
   * Record an HTTP request completion.
   * @param {number} statusCode
   */
  recordRequest(statusCode) {
    // Reset window if expired
    if (Date.now() - this.requestStats.windowStart > this.requestStats.WINDOW_MS) {
      this.requestStats.byStatus = {};
      this.requestStats.total = 0;
      this.requestStats.errors = 0;
      this.requestStats.windowStart = Date.now();
    }

    this.requestStats.total++;
    const key = String(statusCode);
    this.requestStats.byStatus[key] = (this.requestStats.byStatus[key] || 0) + 1;
    if (statusCode >= 500) this.requestStats.errors++;
  }

  // ── Health Report ────────────────────────────────────────────────────

  /**
   * Build a full health report.
   * @returns {{ status: string, uptime: number, timestamp: string, services: object, requests: object, criticalErrors: object[] }}
   */
  getHealth() {
    const now = Date.now();
    const serviceReport = {};
    let hasDegraded = false;
    let hasCritical = false;

    for (const [name, svc] of this.services) {
      const ageMs = now - svc.lastHeartbeat;
      let svcStatus = svc.status;

      // Derive status from heartbeat age if still marked running
      if (svcStatus === 'running') {
        if (ageMs > 5 * 60_000) {
          svcStatus = 'stale';
          hasDegraded = true;
        } else if (ageMs > 2 * 60_000) {
          svcStatus = 'slow';
        }
      }

      if (svcStatus === 'stopped' || svcStatus === 'error') {
        hasCritical = true;
      }

      serviceReport[name] = {
        status: svcStatus,
        lastHeartbeat: new Date(svc.lastHeartbeat).toISOString(),
        heartbeatAgeMs: ageMs,
        errorCount: svc.errorCount,
        lastError: svc.lastError,
      };
    }

    // Check error rate
    const errorRate = this.requestStats.total > 0
      ? this.requestStats.errors / this.requestStats.total
      : 0;
    if (errorRate > 0.5 && this.requestStats.total >= 10) {
      hasCritical = true;
    } else if (errorRate > 0.1 && this.requestStats.total >= 10) {
      hasDegraded = true;
    }

    const overallStatus = hasCritical ? 'critical' : hasDegraded ? 'degraded' : 'healthy';

    return {
      status: overallStatus,
      uptime: Math.floor((now - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      services: serviceReport,
      requests: {
        total: this.requestStats.total,
        byStatus: this.requestStats.byStatus,
        errors: this.requestStats.errors,
        errorRate: errorRate.toFixed(4),
      },
      criticalErrors: this.criticalErrors.slice(-10), // Last 10
    };
  }

  // ── Critical Error Check ─────────────────────────────────────────────

  /**
   * Returns alerts for any services in a bad state.
   * @returns {{ service: string, message: string, timestamp: string }[]}
   */
  checkCriticalErrors() {
    const now = Date.now();
    const alerts = [];

    for (const [name, svc] of this.services) {
      if (svc.status === 'stopped' || svc.status === 'error') {
        alerts.push({
          service: name,
          message: `Service is ${svc.status}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alert on high error count (threshold: 10 errors in last 5 min)
      if (svc.errorCount >= 10 && svc.lastErrorAt && (now - svc.lastErrorAt) < 300_000) {
        alerts.push({
          service: name,
          message: `High error rate: ${svc.errorCount} errors`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return alerts;
  }
}

// Singleton
module.exports = new HealthMonitor();
