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

// GET /api/settings
router.get('/', authMiddleware, async (req, res) => {
  try {
    const settings = await prisma.userSettings.findUnique({ where: { userId: req.userId } });
    res.json({ settings: settings || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings
router.put('/', authMiddleware, async (req, res) => {
  try {
    const settings = await prisma.userSettings.upsert({
      where: { userId: req.userId },
      update: req.body,
      create: { userId: req.userId, ...req.body },
    });
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
