const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Simple admin auth via API key
const ADMIN_KEY = process.env.ADMIN_API_KEY;

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// GET /api/admin/stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalTrades = await prisma.trade.count({ where: { txStatus: 'CONFIRMED' } });
    const totalVolume = await prisma.trade.aggregate({
      where: { txStatus: 'CONFIRMED', action: 'BUY' },
      _sum: { amountInUsd: true },
    });

    res.json({
      totalUsers,
      totalTrades,
      totalVolumeUsd: totalVolume._sum.amountInUsd || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { trades: true } } },
    });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
