const { pool } = require('../db');
const { getTokenHolders, getTokenPrice } = require('../helius');
const { sendTelegramMessage } = require('../routes/webhooks');

async function snapshotAllProjects() {
  try {
    const projects = await pool.query('SELECT * FROM projects');
    for (const project of projects.rows) {
      try {
        const holders = await getTokenHolders(project.mint_address);
        await pool.query(
          `INSERT INTO holders_snapshots (project_id, holder_count, top_holders) VALUES ($1, $2, $3)`,
          [project.id, holders.length, JSON.stringify(holders.slice(0, 10))]
        );
        console.log(`[snapshot] ${project.name}: ${holders.length} holders`);
      } catch (e) {
        console.error(`[snapshot] Failed for ${project.name}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[snapshot] Job failed:', e.message);
  }
}

async function checkMilestones() {
  try {
    const milestones = await pool.query(
      `SELECT m.*, p.mint_address, p.name, p.telegram_bot_token, p.telegram_group_id
       FROM milestones m
       JOIN projects p ON m.project_id = p.id
       WHERE m.triggered = FALSE`
    );

    for (const m of milestones.rows) {
      let currentValue = null;

      if (m.type === 'holder_count') {
        const snap = await pool.query(
          `SELECT holder_count FROM holders_snapshots
           WHERE project_id = $1 ORDER BY snapshot_at DESC LIMIT 1`,
          [m.project_id]
        );
        currentValue = snap.rows[0]?.holder_count;
      } else if (m.type === 'price') {
        currentValue = await getTokenPrice(m.mint_address);
      }

      if (currentValue !== null && Number(currentValue) >= Number(m.target_value)) {
        await pool.query(
          `UPDATE milestones SET triggered = TRUE, triggered_at = NOW() WHERE id = $1`,
          [m.id]
        );

        console.log(`[milestone] TRIGGERED: ${m.name} ${m.type} >= ${m.target_value}`);

        if (m.telegram_bot_token && m.telegram_group_id) {
          const emoji = m.type === 'holder_count' ? '🎯' : '💰';
          const msg =
            `${emoji} *Milestone Hit!* — ${m.name}\n\n` +
            `${m.type === 'holder_count' ? 'Holders' : 'Price'} reached *${Number(m.target_value).toLocaleString()}*\n` +
            `Current: ${Number(currentValue).toLocaleString()}`;

          await sendTelegramMessage(m.telegram_bot_token, m.telegram_group_id, msg);
        }
      }
    }
  } catch (e) {
    console.error('[milestones] Check failed:', e.message);
  }
}

module.exports = { snapshotAllProjects, checkMilestones };
