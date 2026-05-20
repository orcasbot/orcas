const express = require('express');
const router = express.Router();
const walletService = require('../services/wallet/wallet-service');
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

// GET /api/wallet — get wallet address
router.get('/', authMiddleware, async (req, res) => {
  try {
    const wallet = await walletService.getOrCreateWallet(req.userId);
    res.json({ address: wallet.address || wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wallet/balance — get ETH balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const balance = await walletService.getBalance(req.userId);
    res.json(balance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
