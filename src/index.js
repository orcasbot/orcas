require('dotenv').config();

const dns = require('dns');
dns.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const prisma = require('./lib/prisma');

const config = require('./config');
const logger = require('./utils/logger');
const { createBot } = require('./bot/index');
const TradeOrchestrator = require('./services/trade-orchestrator');
const walletService = require('./services/wallet/wallet-service');
const priceOracle = require('./services/price-oracle');
const NotificationService = require('./services/notifications');
const AutoSellService = require('./services/auto-sell');
const DepositMonitor = require('./services/deposit-monitor');
const MonitorRunner = require('./services/monitor-runner');
const PremiumExpiryService = require('./services/premium-expiry');

const { apiLimiter, authLimiter } = require('./middleware/rate-limiter');

async function main() {
  // ============================================
  // EXPRESS SERVER
  // ============================================
  const app = express();
  const server = http.createServer(app);

  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : [config.frontendUrl],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(':remote-addr :method :url :status :response-time ms'));

  // Health check
  app.get('/health', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', uptime: process.uptime() });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  // Routes
  const authRoutes = require('./routes/auth');
  const tradeRoutes = require('./routes/trades');
  const settingsRoutes = require('./routes/settings');
  const walletRoutes = require('./routes/wallet');
  const adminRoutes = require('./routes/admin');

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/trades', apiLimiter, tradeRoutes);
  app.use('/api/settings', apiLimiter, settingsRoutes);
  app.use('/api/wallet', apiLimiter, walletRoutes);
  app.use('/api/admin', adminRoutes);

  // Error handler
  app.use((err, req, res, _next) => {
    logger.error('Unhandled route error', { error: err.message, path: req.path });
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });

  // ============================================
  // SOCKET.IO
  // ============================================
  const io = new SocketIO(server, {
    cors: {
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : [config.frontendUrl],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, config.jwt.secret);
      socket.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
      logger.debug('Socket connected');
    }
  });

  // ============================================
  // TELEGRAM BOT + LLM
  // ============================================
  const ClaudeClient = require('./services/llm/claude-client');
  const LlmRateLimiter = require('./services/llm/rate-limiter');
  const claudeClient = new ClaudeClient(config);
  const llmRateLimiter = new LlmRateLimiter();
  const bot = createBot(claudeClient, llmRateLimiter);
  const notifications = new NotificationService(bot);

  // ============================================
  // TRADE ORCHESTRATOR
  // ============================================
  const orchestrator = new TradeOrchestrator(io);

  orchestrator.notifyUser = (userId, event, data) => {
    (async () => {
      try {
        switch (event) {
          case 'trade:confirmed':
            await notifications.notifyTradeConfirmed(userId, data, io);
            break;
          case 'trade:failed':
            await notifications.notifyTradeFailed(userId, data, io);
            break;
        }
      } catch (err) {
        logger.error('Notification dispatch failed', { userId, event, error: err.message });
      }
    })();
  };

  // Wire up tool executor
  const toolExecutor = require('./services/llm/tool-executor');
  const { checkTokenSafety } = require('./services/safety/token-safety');

  toolExecutor.setServices({
    orchestrator,
    walletService,
    priceOracle,
    notifications,
    checkTokenSafety,
  });

  // Wire up alpha handler
  require('./bot/handlers/alpha').setOrchestrator(orchestrator);

  // ============================================
  // BACKGROUND SERVICES
  // ============================================
  const autoSell = new AutoSellService(io, orchestrator, notifications);
  autoSell.start().catch(err => logger.error('AutoSell start failed', { error: err.message }));

  const depositMonitor = new DepositMonitor({ notifications, priceOracle });
  depositMonitor.start().catch(err => logger.error('DepositMonitor start failed', { error: err.message }));

  const monitorRunner = new MonitorRunner(orchestrator, notifications);
  monitorRunner.start().catch(err => logger.error('MonitorRunner start failed', { error: err.message }));

  const premiumExpiry = new PremiumExpiryService();
  premiumExpiry.start().catch(err => logger.error('PremiumExpiry start failed', { error: err.message }));

  // ============================================
  // START BOT
  // ============================================
  async function startBot(retries = 6) {
    await new Promise(r => setTimeout(r, 3000));
    for (let i = 0; i < retries; i++) {
      try {
        await bot.api.deleteWebhook({ drop_pending_updates: true });
        await bot.start({ onStart: () => logger.info('Orcas bot started') });
        return;
      } catch (err) {
        if (err.error_code === 409 && i < retries - 1) {
          const delay = 5000 * (i + 1);
          logger.warn(`Bot start failed (attempt ${i + 1}), retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        logger.error('Bot failed to start', { error: err.message });
        return;
      }
    }
  }
  startBot();

  // ============================================
  // START SERVER
  // ============================================
  server.listen(config.port, () => {
    logger.info(`Orcas running on port ${config.port}`);
  });

  // Warm price cache
  priceOracle.getEthPrice().catch(() => {});

  // DB keepalive
  setInterval(() => {
    prisma.$queryRaw`SELECT 1`.catch(() => {});
  }, 4 * 60 * 1000);
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});
