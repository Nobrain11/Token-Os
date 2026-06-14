const express = require('express');
const router = express.Router();
const db = require('../services/db');

// Helius webhook receiver
router.post('/helius', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(200);

  for (const event of events) {
    try {
      const mint = event.tokenTransfers?.[0]?.mint || event.accountData?.[0]?.account;
      if (!mint) continue;

      // Find project by mint
      const proj = await db.query(
        'SELECT * FROM projects WHERE mint_address = $1',
        [mint]
      );
      if (!proj.rows.length) continue;

      const project = proj.rows[0];

      // Handle burn events
      if (event.type === 'BURN') {
        await checkMilestones(project, 'burn', event);
        await notifyTelegram(project, `🔥 *BURN DETECTED*\nAmount: ${event.tokenTransfers?.[0]?.tokenAmount?.toFixed(2) || '?'} tokens burned!\nTx: https://solscan.io/tx/${event.signature}`);
      }

      // Handle large transfers (whale alert)
      if (event.type === 'TRANSFER') {
        const amount = event.tokenTransfers?.[0]?.tokenAmount;
        if (amount && amount > 1000000) { // configurable threshold
          await notifyTelegram(project, `🐋 *WHALE ALERT*\n${amount.toFixed(0)} tokens moved\nTx: https://solscan.io/tx/${event.signature}`);
        }
      }

    } catch (err) {
      console.error('Webhook processing error:', err.message);
    }
  }

  res.sendStatus(200);
});

async function checkMilestones(project, type, event) {
  try {
    const milestones = await db.query(
      `SELECT * FROM milestones WHERE project_id = $1 AND type = $2 AND triggered = FALSE`,
      [project.id, type]
    );

    for (const m of milestones.rows) {
      // Simple milestone check — extend with real logic per type
      await db.query(
        'UPDATE milestones SET triggered = TRUE, triggered_at = NOW() WHERE id = $1',
        [m.id]
      );
      await notifyTelegram(project, `🎯 *MILESTONE REACHED!*\n${m.type}: ${m.target_value}`);
    }
  } catch (err) {
    console.error('Milestone check error:', err.message);
  }
}

async function notifyTelegram(project, message) {
  if (!project.telegram_group_id || !project.telegram_bot_token) return;

  try {
    const axios = require('axios');
    await axios.post(
      `https://api.telegram.org/bot${project.telegram_bot_token}/sendMessage`,
      {
        chat_id: project.telegram_group_id,
        text: message,
        parse_mode: 'Markdown'
      }
    );
  } catch (err) {
    console.error('Telegram notify error:', err.message);
  }
}

module.exports = router;
