/**
 * smartMoney.js
 * Scores wallets on smart money behavior.
 */

const { pool } = require('../db');

const WEIGHTS = {
  entryTiming: 0.30,
  winRate: 0.30,
  exitEfficiency: 0.20,
  activityConsistency: 0.20,
};

const walletBehavior = new Map();

function getWallet(address) {
  if (!walletBehavior.has(address)) {
    walletBehavior.set(address, {
      address,
      entries: [],
      exits: [],
      profits: [],
      tokens: new Set(),
      lastActive: null,
    });
  }
  return walletBehavior.get(address);
}

function recordEntry(wallet, { mint, timestamp, price, holderCountAtEntry }) {
  const w = getWallet(wallet);
  w.entries.push({ mint, timestamp, price, holderCountAtEntry });
  w.tokens.add(mint);
  w.lastActive = timestamp;
}

function recordExit(wallet, { mint, timestamp, price, entryPrice }) {
  const w = getWallet(wallet);
  const pnl = entryPrice ? ((price - entryPrice) / entryPrice) * 100 : null;
  w.exits.push({ mint, timestamp, price, pnl });
  if (pnl !== null) w.profits.push(pnl);
  w.lastActive = timestamp;
}

function entryTimingScore(wallet) {
  const w = getWallet(wallet);
  if (!w.entries.length) return 0;

  const scores = w.entries.map(e => {
    const hc = e.holderCountAtEntry || 1000;
    if (hc < 100) return 1.0;
    if (hc < 500) return 0.8;
    if (hc < 1000) return 0.6;
    if (hc < 5000) return 0.4;
    return 0.2;
  });

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function winRate(wallet) {
  const w = getWallet(wallet);
  if (!w.profits.length) return 0;
  const wins = w.profits.filter(p => p > 0).length;
  return wins / w.profits.length;
}

function exitEfficiency(wallet) {
  const w = getWallet(wallet);
  if (!w.profits.length) return 0;
  const avg = w.profits.reduce((a, b) => a + b, 0) / w.profits.length;
  return Math.max(0, Math.min(1, (avg + 100) / 200));
}

function activityConsistency(wallet) {
  const w = getWallet(wallet);
  const tokenDiversity = Math.min(w.tokens.size / 10, 1);
  const entryFrequency = Math.min(w.entries.length / 20, 1);
  return (tokenDiversity + entryFrequency) / 2;
}

function smartMoneyScore(wallet) {
  const scores = {
    entryTiming: entryTimingScore(wallet),
    winRate: winRate(wallet),
    exitEfficiency: exitEfficiency(wallet),
    activityConsistency: activityConsistency(wallet),
  };

  const total =
    scores.entryTiming * WEIGHTS.entryTiming +
    scores.winRate * WEIGHTS.winRate +
    scores.exitEfficiency * WEIGHTS.exitEfficiency +
    scores.activityConsistency * WEIGHTS.activityConsistency;

  return {
    wallet,
    score: Math.round(total * 100) / 100,
    scores,
    label: total >= 0.75 ? 'ELITE'
      : total >= 0.55 ? 'SMART'
      : total >= 0.35 ? 'AVERAGE'
      : 'WEAK',
    entryCount: walletBehavior.get(wallet)?.entries.length || 0,
    exitCount: walletBehavior.get(wallet)?.exits.length || 0,
  };
}

function getTopSmartMoney(limit = 20) {
  const results = [];
  for (const wallet of walletBehavior.keys()) {
    const w = walletBehavior.get(wallet);
    if (w.entries.length >= 2) {
      results.push(smartMoneyScore(wallet));
    }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function getSmartMoneyForToken(mint, limit = 10) {
  const results = [];
  for (const [wallet, data] of walletBehavior) {
    if (data.tokens.has(mint)) {
      results.push(smartMoneyScore(wallet));
    }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function persistSmartMoneySnapshot(projectId) {
  try {
    const top = getTopSmartMoney(50);
    if (!top.length) return;
    await pool.query(
      `INSERT INTO smart_money_snapshots (project_id, snapshot, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT DO NOTHING`,
      [projectId, JSON.stringify(top)]
    );
  } catch (e) {
    console.error('[smartMoney] Persist failed:', e.message);
  }
}

module.exports = {
  recordEntry,
  recordExit,
  smartMoneyScore,
  getTopSmartMoney,
  getSmartMoneyForToken,
  persistSmartMoneySnapshot,
  walletBehavior,
};
