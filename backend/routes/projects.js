const express = require('express');
const router = express.Router();
const db = require('../services/db');
const helius = require('../services/helius');
const { v4: uuidv4 } = require('uuid');

// Register a new token project
router.post('/register', async (req, res) => {
  const { name, mintAddress, ownerWallet } = req.body;
  if (!name || !mintAddress || !ownerWallet) {
    return res.status(400).json({ error: 'name, mintAddress, ownerWallet required' });
  }

  try {
    // Verify token exists on-chain
    const metadata = await helius.getTokenMetadata(mintAddress);

    const result = await db.query(
      `INSERT INTO projects (name, mint_address, owner_wallet, subscription_status, subscription_expires_at)
       VALUES ($1, $2, $3, 'trial', NOW() + INTERVAL '7 days')
       ON CONFLICT (mint_address) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [name, mintAddress, ownerWallet]
    );

    res.json({ project: result.rows[0], metadata });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register project' });
  }
});

// Get all projects for a wallet
router.get('/by-wallet/:wallet', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM projects WHERE owner_wallet = $1 ORDER BY created_at DESC',
      [req.params.wallet]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get single project
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Get live holder data
router.get('/:id/holders', async (req, res) => {
  try {
    const proj = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!proj.rows.length) return res.status(404).json({ error: 'Not found' });

    const data = await helius.getTokenHolders(proj.rows[0].mint_address);

    // Save snapshot
    await db.query(
      `INSERT INTO holders_snapshots (project_id, holder_count, top_holders)
       VALUES ($1, $2, $3)`,
      [req.params.id, data.totalHolders, JSON.stringify(data.topHolders)]
    );

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch holders' });
  }
});

// Get holder history (snapshots over time)
router.get('/:id/holders/history', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT holder_count, snapshot_at FROM holders_snapshots
       WHERE project_id = $1
       ORDER BY snapshot_at ASC
       LIMIT 30`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get token metadata + price
router.get('/:id/overview', async (req, res) => {
  try {
    const proj = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
    if (!proj.rows.length) return res.status(404).json({ error: 'Not found' });

    const mint = proj.rows[0].mint_address;

    const [metadata, price, holderData] = await Promise.all([
      helius.getTokenMetadata(mint),
      helius.getTokenPrice(mint),
      helius.getTokenHolders(mint)
    ]);

    res.json({
      project: proj.rows[0],
      metadata,
      price,
      holderCount: holderData.totalHolders,
      topHolders: holderData.topHolders.slice(0, 5)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// Set Telegram group
router.post('/:id/telegram', async (req, res) => {
  const { telegramGroupId, telegramBotToken } = req.body;
  try {
    await db.query(
      'UPDATE projects SET telegram_group_id = $1, telegram_bot_token = $2 WHERE id = $3',
      [telegramGroupId, telegramBotToken, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update telegram settings' });
  }
});

// Set milestone
router.post('/:id/milestones', async (req, res) => {
  const { type, targetValue } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO milestones (project_id, type, target_value)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, type, targetValue]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create milestone' });
  }
});

// Get milestones
router.get('/:id/milestones', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM milestones WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch milestones' });
  }
});

module.exports = router;
