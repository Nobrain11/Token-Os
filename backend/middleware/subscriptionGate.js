const db = require('../services/db');

// Blocks access to premium routes unless the project has an active
// subscription or is still within its trial window.
async function requireActiveSubscription(req, res, next) {
  const projectId = req.params.projectId || req.params.id;

  try {
    const proj = await db.query(
      'SELECT subscription_status, subscription_expires_at, name FROM projects WHERE id = $1',
      [projectId]
    );

    if (!proj.rows.length) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { subscription_expires_at } = proj.rows[0];
    const isActive = subscription_expires_at && new Date(subscription_expires_at) > new Date();

    if (!isActive) {
      return res.status(402).json({
        error: 'subscription_required',
        message: 'Your trial has ended. Subscribe in Billing to keep using this feature.'
      });
    }

    next();
  } catch (err) {
    console.error('Subscription check error:', err.message);
    res.status(500).json({ error: 'Subscription check failed' });
  }
}

module.exports = { requireActiveSubscription };
