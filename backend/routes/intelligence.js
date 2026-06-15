/**
 * routes/intelligence.js
 * API routes for the wallet intelligence system.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { getSignals, getAllSignals, analyzeToken } = require('../intelligence/behaviorEngine');
const { getSmartMoneyForToken, getTopSmartMoney, smartMoneyScore } = require('../intelligence/smartMoney');
const { graph } = require('../intelligence/walletGraph');
const { evolveSignals } = require('../intelligence/signalEvolution');

async function resolveProject(id) {
  const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
  return result.rows[0] || null;
}

router.get('/:id/signals', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const limit = parseInt(req.query.limit) || 20;
    const signals = getSignals(project.mint_address, limit);

    const enriched = signals.map(s => ({
      ...s,
      phaseLabel: ['', 'DETECTED', 'CONFIRMED', 'EXPANDING', 'WARNING'][s.phase] || 'UNKNOWN',
      age: Math.round((Date.now() - s.timestamp) / 1000 / 60) + 'm ago',
    }));

    res.json({
      mint: project.mint_address,
      projectName: project.name,
      signals: enriched,
      total: enriched.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/smart-money', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const limit = parseInt(req.query.limit) || 10;
    const smartWallets = getSmartMoneyForToken(project.mint_address, limit);

    res.json({
      mint: project.mint_address,
      projectName: project.name,
      smartMoney: smartWallets,
      total: smartWallets.length,
      summary: {
        eliteCount: smartWallets.filter(w => w.label === 'ELITE').length,
        smartCount: smartWallets.filter(w => w.label === 'SMART').length,
        avgScore: smartWallets.length
          ? Math.round(smartWallets.reduce((s, w) => s + w.score, 0) / smartWallets.length * 100) / 100
          : 0,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/graph', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const tokenWallets = graph.getTokenWallets(project.mint_address);
    const clusters = graph.getClusters(0.3);

    const tokenWalletSet = new Set(tokenWallets.map(w => w.wallet));
    const relevantClusters = clusters
      .map(c => c.filter(w => tokenWalletSet.has(w)))
      .filter(c => c.length >= 2)
      .slice(0, 10);

    const topConnected = tokenWallets
      .map(node => ({
        wallet: node.wallet,
        txCount: node.txCount,
        totalVolume: node.totalVolume,
        neighbourCount: graph.getNeighbours(node.wallet).length,
        firstSeen: node.firstSeen,
        lastSeen: node.lastSeen,
      }))
      .sort((a, b) => b.neighbourCount - a.neighbourCount)
      .slice(0, 20);

    res.json({
      mint: project.mint_address,
      stats: graph.stats(),
      tokenWalletCount: tokenWallets.length,
      clusters: relevantClusters,
      clusterCount: relevantClusters.length,
      topConnected,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/wallet/:address', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { address } = req.params;
    const score = smartMoneyScore(address);
    const neighbours = graph.getNeighbours(address).slice(0, 10);
    const node = graph.nodes.get(address);

    res.json({
      wallet: address,
      smartMoney: score,
      graph: {
        txCount: node?.txCount || 0,
        totalVolume: node?.totalVolume || 0,
        firstSeen: node?.firstSeen || null,
        lastSeen: node?.lastSeen || null,
        tokens: node ? [...node.tokens] : [],
        topConnections: neighbours.map(n => ({
          wallet: n.peer,
          weight: Math.round(n.weight * 100) / 100,
          interactions: n.edge.interactions,
          totalVolume: n.edge.totalVolume,
        })),
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/analyze', async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const fired = analyzeToken(project.mint_address, {
      holderCount: req.body.holderCount,
      prevHolderCount: req.body.prevHolderCount,
    });

    const evolutions = await evolveSignals(project.mint_address);

    res.json({
      mint: project.mint_address,
      signalsFired: fired.length,
      signals: fired,
      evolutions: evolutions || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/global/signals', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const all = getAllSignals(limit);

    const mints = [...new Set(all.map(s => s.mint).filter(Boolean))];
    let projectMap = {};

    if (mints.length) {
      const result = await pool.query(
        'SELECT id, name, mint_address FROM projects WHERE mint_address = ANY($1)',
        [mints]
      );
      for (const row of result.rows) {
        projectMap[row.mint_address] = row;
      }
    }

    const enriched = all.map(s => ({
      ...s,
      projectName: projectMap[s.mint]?.name || 'Unknown',
      phaseLabel: ['', 'DETECTED', 'CONFIRMED', 'EXPANDING', 'WARNING'][s.phase] || 'UNKNOWN',
      age: Math.round((Date.now() - s.timestamp) / 1000 / 60) + 'm ago',
    }));

    res.json({ signals: enriched, total: enriched.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
