const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const jwt = require('jsonwebtoken');
const config = require('../config');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, config.jwt.secret);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /api/trades — get trade history
router.get('/', authMiddleware, async (req, res) => {
  try {
    const trades = await prisma.trade.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(req.query.limit) || 20,
    });
    res.json({ trades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trades/stats — get trading stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const totalTrades = await prisma.trade.count({
      where: { userId: req.userId, txStatus: 'CONFIRMED' },
    });
    const buys = await prisma.trade.count({
      where: { userId: req.userId, action: 'BUY', txStatus: 'CONFIRMED' },
    });
    const sells = await prisma.trade.count({
      where: { userId: req.userId, action: 'SELL', txStatus: 'CONFIRMED' },
    });
    res.json({ totalTrades, buys, sells });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
