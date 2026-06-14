const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { Connection } = require('@solana/web3.js');
const { generateReference, buildPaymentUrl, verifyPayment } = require('../services/solanaPay');

const FEE_WALLET = process.env.FEE_WALLET;
const SUBSCRIPTION_PRICE_SOL = Number(process.env.SUBSCRIPTION_PRICE_SOL || 1);
const SUBSCRIPTION_DAYS = Number(process.env.SUBSCRIPTION_DAYS || 30);

const connection = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  'confirmed'
);

// Get current subscription status
router.get('/:projectId/status', async (req, res) => {
  try {
    const proj = await db.query(
      'SELECT subscription_status, subscription_expires_at FROM projects WHERE id = $1',
      [req.params.projectId]
    );
    if (!proj.rows.length) return res.status(404).json({ error: 'Not found' });

    const { subscription_status, subscription_expires_at } = proj.rows[0];
    const expires = subscription_expires_at ? new Date(subscription_expires_at) : null;
    const now = new Date();
    const isActive = expires ? expires > now : false;
    const daysLeft = expires ? Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24))) : 0;

    res.json({
      status: isActive ? subscription_status : 'expired',
      expiresAt: subscription_expires_at,
      daysLeft,
      priceSol: SUBSCRIPTION_PRICE_SOL,
      subscriptionDays: SUBSCRIPTION_DAYS
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Create a Solana Pay payment request
router.post('/:projectId/create-payment', async (req, res) => {
  if (!FEE_WALLET) {
    return res.status(500).json({ error: 'FEE_WALLET not configured on server' });
  }

  try {
    const proj = await db.query('SELECT name FROM projects WHERE id = $1', [req.params.projectId]);
    if (!proj.rows.length) return res.status(404).json({ error: 'Not found' });

    const reference = generateReference();

    await db.query(
      `INSERT INTO payments (project_id, reference, amount_sol, status)
       VALUES ($1, $2, $3, 'pending')`,
      [req.params.projectId, reference, SUBSCRIPTION_PRICE_SOL]
    );

    const url = buildPaymentUrl({
      recipient: FEE_WALLET,
      amount: SUBSCRIPTION_PRICE_SOL,
      reference,
      label: 'Token OS',
      message: `${proj.rows[0].name} — ${SUBSCRIPTION_DAYS}-day subscription`
    });

    res.json({
      reference,
      url,
      amount: SUBSCRIPTION_PRICE_SOL,
      recipient: FEE_WALLET,
      days: SUBSCRIPTION_DAYS
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Verify a payment by reference and activate subscription if confirmed
router.get('/:projectId/verify/:reference', async (req, res) => {
  try {
    const payment = await db.query(
      'SELECT * FROM payments WHERE reference = $1 AND project_id = $2',
      [req.params.reference, req.params.projectId]
    );
    if (!payment.rows.length) return res.status(404).json({ error: 'Payment not found' });

    if (payment.rows[0].status === 'confirmed') {
      return res.json({ confirmed: true, alreadyConfirmed: true });
    }

    const result = await verifyPayment(
      connection,
      req.params.reference,
      FEE_WALLET,
      Number(payment.rows[0].amount_sol)
    );

    if (result.confirmed) {
      await db.query(
        `UPDATE payments SET status = 'confirmed', tx_signature = $1, confirmed_at = NOW()
         WHERE reference = $2`,
        [result.signature, req.params.reference]
      );

      // Extend from current expiry if still active, otherwise from now
      const proj = await db.query(
        'SELECT subscription_expires_at FROM projects WHERE id = $1',
        [req.params.projectId]
      );
      const current = proj.rows[0]?.subscription_expires_at;
      const base = current && new Date(current) > new Date() ? new Date(current) : new Date();
      base.setDate(base.getDate() + SUBSCRIPTION_DAYS);

      await db.query(
        `UPDATE projects SET subscription_status = 'active', subscription_expires_at = $1
         WHERE id = $2`,
        [base.toISOString(), req.params.projectId]
      );

      return res.json({ confirmed: true, signature: result.signature, newExpiry: base.toISOString() });
    }

    res.json({ confirmed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

module.exports = router;
