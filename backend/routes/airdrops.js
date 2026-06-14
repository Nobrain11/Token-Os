const express = require('express');
const router = express.Router();
const db = require('../services/db');
const helius = require('../services/helius');
const { requireActiveSubscription } = require('../middleware/subscriptionGate');
const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const FEE_WALLET = process.env.FEE_WALLET || 'YOUR_FEE_WALLET_HERE';
const FEE_PERCENT = 0.01; // 1%

const connection = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  'confirmed'
);

// Preview airdrop — snapshot holders, show distribution
router.post('/:projectId/preview', requireActiveSubscription, async (req, res) => {
  const { totalAmount, topN, minHolding } = req.body;

  try {
    const proj = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.projectId]);
    if (!proj.rows.length) return res.status(404).json({ error: 'Project not found' });

    const holderData = await helius.getTokenHolders(proj.rows[0].mint_address);

    let recipients = holderData.allHolders;

    // Filter by min holding if set
    if (minHolding) {
      recipients = recipients.filter(h => Number(h.amount) >= minHolding);
    }

    // Limit to top N
    if (topN) {
      recipients = recipients.slice(0, topN);
    }

    const feeAmount = totalAmount * FEE_PERCENT;
    const netAmount = totalAmount - feeAmount;
    const perWallet = netAmount / recipients.length;

    res.json({
      recipientCount: recipients.length,
      totalAmount,
      feeAmount,
      netAmount,
      perWallet,
      topRecipients: recipients.slice(0, 10).map(h => ({
        wallet: h.owner,
        holding: Number(h.amount)
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to preview airdrop' });
  }
});

// Record airdrop (frontend handles actual tx signing)
router.post('/:projectId/record', requireActiveSubscription, async (req, res) => {
  const { totalAmount, feeAmount, recipientCount, txSignature } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO airdrops (project_id, total_amount, fee_amount, recipient_count, status, tx_signature)
       VALUES ($1, $2, $3, $4, 'complete', $5) RETURNING *`,
      [req.params.projectId, totalAmount, feeAmount, recipientCount, txSignature]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to record airdrop' });
  }
});

// Get airdrop history
router.get('/:projectId/history', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM airdrops WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch airdrop history' });
  }
});

module.exports = router;
