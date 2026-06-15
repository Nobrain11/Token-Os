/**
 * behaviorEngine.js
 * Core signal detection engine.
 */

const { graph } = require('./walletGraph');
const { smartMoneyScore } = require('./smartMoney');

const eventBuffer = new Map();
const BUFFER_WINDOW_MS = 5 * 60 * 1000;

function pushEvent(mint, event) {
  if (!eventBuffer.has(mint)) eventBuffer.set(mint, []);
  const buf = eventBuffer.get(mint);
  buf.push({ ...event, timestamp: event.timestamp || Date.now() });
  const cutoff = Date.now() - BUFFER_WINDOW_MS;
  const pruned = buf.filter(e => e.timestamp >= cutoff);
  eventBuffer.set(mint, pruned);
}

function getRecentEvents(mint, windowMs = BUFFER_WINDOW_MS) {
  const buf = eventBuffer.get(mint) || [];
  const cutoff = Date.now() - windowMs;
  return buf.filter(e => e.timestamp >= cutoff);
}

const signals = new Map();

function emitSignal(mint, signal) {
  if (!signals.has(mint)) signals.set(mint, []);
  const list = signals.get(mint);

  const recent = list.find(s =>
    s.type === signal.type &&
    (Date.now() - s.timestamp) < 10 * 60 * 1000
  );
  if (recent) return null;

  const entry = {
    ...signal,
    id: `${mint}-${signal.type}-${Date.now()}`,
    mint,
    timestamp: Date.now(),
    phase: signal.phase || 1,
  };

  list.push(entry);
  if (list.length > 100) list.shift();

  console.log(`[signal] ${signal.type} on ${mint.slice(0,8)}... — ${signal.summary}`);
  return entry;
}

function getSignals(mint, limit = 20) {
  return (signals.get(mint) || [])
    .slice(-limit)
    .reverse();
}

function getAllSignals(limit = 50) {
  const all = [];
  for (const list of signals.values()) all.push(...list);
  return all
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

function detectSniperCluster(mint, events) {
  const window60s = events.filter(e =>
    e.type === 'buy' &&
    (Date.now() - e.timestamp) <= 60_000
  );

  const uniqueWallets = new Set(window60s.map(e => e.wallet));
  if (uniqueWallets.size < 5) return null;

  const walletList = [...uniqueWallets];
  let connectedPairs = 0;
  for (let i = 0; i < walletList.length; i++) {
    for (let j = i + 1; j < walletList.length; j++) {
      const key = [walletList[i], walletList[j]].sort().join('|');
      if (graph.edges.has(key)) connectedPairs++;
    }
  }

  const maxPairs = (walletList.length * (walletList.length - 1)) / 2;
  const connectionRatio = connectedPairs / maxPairs;
  if (connectionRatio > 0.5) return null;

  const totalVolume = window60s.reduce((s, e) => s + (e.amount || 0), 0);

  return emitSignal(mint, {
    type: 'COORDINATED_SNIPER_CLUSTER',
    phase: 1,
    severity: 'HIGH',
    summary: `${uniqueWallets.size} new wallets entered within 60s`,
    wallets: walletList,
    walletCount: uniqueWallets.size,
    totalVolume,
    connectionRatio: Math.round(connectionRatio * 100) / 100,
    interpretation: 'Coordinated snipers detected. High risk of coordinated pump.',
  });
}

function detectAccumulation(mint, events) {
  const buys = events.filter(e => e.type === 'buy');
  const sells = events.filter(e => e.type === 'sell');

  if (buys.length < 3) return null;

  const sellRatio = sells.length / (buys.length + sells.length);
  if (sellRatio > 0.25) return null;

  const buyerScores = buys.map(e => {
    try { return smartMoneyScore(e.wallet).score; } catch { return 0; }
  });
  const avgSmartScore = buyerScores.reduce((a, b) => a + b, 0) / buyerScores.length;

  if (avgSmartScore < 0.3) return null;

  const uniqueBuyers = new Set(buys.map(e => e.wallet));
  const totalBuyVolume = buys.reduce((s, e) => s + (e.amount || 0), 0);

  return emitSignal(mint, {
    type: 'ACCUMULATION_PHASE',
    phase: 2,
    severity: 'MEDIUM',
    summary: `${uniqueBuyers.size} smart wallets accumulating (sell ratio ${Math.round(sellRatio*100)}%)`,
    wallets: [...uniqueBuyers],
    walletCount: uniqueBuyers.size,
    sellRatio: Math.round(sellRatio * 100) / 100,
    avgSmartScore: Math.round(avgSmartScore * 100) / 100,
    totalBuyVolume,
    interpretation: 'Smart money quietly accumulating. Watch for breakout.',
  });
}

function detectMomentum(mint, events, holderCount, prevHolderCount) {
  if (!holderCount || !prevHolderCount) return null;

  const growthRate = (holderCount - prevHolderCount) / prevHolderCount;
  if (growthRate < 0.05) return null;

  const newBuyers = new Set(
    events.filter(e => e.type === 'buy').map(e => e.wallet)
  );

  if (newBuyers.size < 10) return null;

  return emitSignal(mint, {
    type: 'MOMENTUM_EXPANSION',
    phase: 3,
    severity: 'MEDIUM',
    summary: `Holder growth +${Math.round(growthRate * 100)}% — ${newBuyers.size} new wallets`,
    holderCount,
    prevHolderCount,
    growthRate: Math.round(growthRate * 100) / 100,
    newBuyerCount: newBuyers.size,
    interpretation: 'Momentum expanding. Organic growth signal.',
  });
}

function detectDistribution(mint, events) {
  const sells = events.filter(e => e.type === 'sell');
  if (sells.length < 3) return null;

  const smartSellers = sells.filter(e => {
    try { return smartMoneyScore(e.wallet).score >= 0.55; } catch { return false; }
  });

  if (smartSellers.length < 2) return null;

  const buys = events.filter(e => e.type === 'buy');
  const buyVolume = buys.reduce((s, e) => s + (e.amount || 0), 0);
  const sellVolume = sells.reduce((s, e) => s + (e.amount || 0), 0);

  if (sellVolume < buyVolume * 0.3) return null;

  const uniqueSmartSellers = new Set(smartSellers.map(e => e.wallet));

  return emitSignal(mint, {
    type: 'DISTRIBUTION_WARNING',
    phase: 4,
    severity: 'HIGH',
    summary: `${uniqueSmartSellers.size} smart money wallets distributing`,
    wallets: [...uniqueSmartSellers],
    walletCount: uniqueSmartSellers.size,
    sellVolume,
    buyVolume,
    interpretation: 'Smart money exiting. Potential top forming. Exercise caution.',
  });
}

function detectWhaleAccumulation(mint, events) {
  const buys = events.filter(e => e.type === 'buy');
  if (!buys.length) return null;

  const byWallet = {};
  for (const e of buys) {
    if (!byWallet[e.wallet]) byWallet[e.wallet] = [];
    byWallet[e.wallet].push(e);
  }

  for (const [wallet, walletBuys] of Object.entries(byWallet)) {
    if (walletBuys.length < 3) continue;
    const totalVol = walletBuys.reduce((s, e) => s + (e.amount || 0), 0);
    const totalAllVol = buys.reduce((s, e) => s + (e.amount || 0), 0);
    const dominance = totalAllVol > 0 ? totalVol / totalAllVol : 0;

    if (dominance >= 0.30) {
      return emitSignal(mint, {
        type: 'WHALE_ACCUMULATION',
        phase: 2,
        severity: 'HIGH',
        summary: `Single wallet controls ${Math.round(dominance*100)}% of buy volume`,
        wallet,
        buyCount: walletBuys.length,
        totalVolume: totalVol,
        dominance: Math.round(dominance * 100) / 100,
        interpretation: 'Large single wallet accumulating. Monitor for follow-through.',
      });
    }
  }
  return null;
}

function detectWashTrade(mint, events) {
  const walletPairs = {};

  for (const e of events) {
    const neighbours = graph.getNeighbours(e.wallet);
    for (const { peer, weight } of neighbours) {
      if (weight < 1) continue;
      const peerEvents = events.filter(ev => ev.wallet === peer);
      if (!peerEvents.length) continue;

      const key = [e.wallet, peer].sort().join('|');
      if (!walletPairs[key]) walletPairs[key] = { wallets: [e.wallet, peer], count: 0, volume: 0 };
      walletPairs[key].count++;
      walletPairs[key].volume += (e.amount || 0);
    }
  }

  const suspiciousPairs = Object.values(walletPairs).filter(p => p.count >= 4);
  if (!suspiciousPairs.length) return null;

  const totalWashVolume = suspiciousPairs.reduce((s, p) => s + p.volume, 0);

  return emitSignal(mint, {
    type: 'WASH_TRADE_SUSPICION',
    phase: 1,
    severity: 'MEDIUM',
    summary: `${suspiciousPairs.length} wallet pairs trading back and forth`,
    pairCount: suspiciousPairs.length,
    totalWashVolume,
    pairs: suspiciousPairs.slice(0, 5),
    interpretation: 'Possible wash trading detected. Volume may be artificial.',
  });
}

function analyzeToken(mint, { holderCount, prevHolderCount } = {}) {
  const events = getRecentEvents(mint);
  if (!events.length) return [];

  const fired = [];
  const detectors = [
    () => detectSniperCluster(mint, events),
    () => detectAccumulation(mint, events),
    () => detectMomentum(mint, events, holderCount, prevHolderCount),
    () => detectDistribution(mint, events),
    () => detectWhaleAccumulation(mint, events),
    () => detectWashTrade(mint, events),
  ];

  for (const detect of detectors) {
    try {
      const result = detect();
      if (result) fired.push(result);
    } catch (e) {
      console.error('[behaviorEngine] Detector error:', e.message);
    }
  }

  return fired;
}

module.exports = {
  pushEvent,
  analyzeToken,
  getSignals,
  getAllSignals,
  emitSignal,
  eventBuffer,
};
