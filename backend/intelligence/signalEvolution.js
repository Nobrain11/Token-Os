/**
 * signalEvolution.js
 * Watches emitted signals and evolves them through phases.
 */

const { getSignals, getAllSignals } = require('./behaviorEngine');
const { pool } = require('../db');
const axios = require('axios');

const UPGRADE_RULES = [
  {
    trigger: 'COORDINATED_SNIPER_CLUSTER',
    confirms: 'ACCUMULATION_PHASE',
    windowMs: 10 * 60 * 1000,
    upgradeTo: { phase: 2, label: 'CONFIRMED_CLUSTER_ACCUMULATION' },
  },
  {
    trigger: 'ACCUMULATION_PHASE',
    confirms: 'MOMENTUM_EXPANSION',
    windowMs: 20 * 60 * 1000,
    upgradeTo: { phase: 3, label: 'MOMENTUM_BREAKOUT' },
  },
  {
    trigger: 'MOMENTUM_EXPANSION',
    confirms: 'DISTRIBUTION_WARNING',
    windowMs: 30 * 60 * 1000,
    upgradeTo: { phase: 4, label: 'DISTRIBUTION_ALERT' },
  },
  {
    trigger: 'WHALE_ACCUMULATION',
    confirms: 'ACCUMULATION_PHASE',
    windowMs: 15 * 60 * 1000,
    upgradeTo: { phase: 2, label: 'CONFIRMED_WHALE_ACCUMULATION' },
  },
];

const evolved = new Set();

async function sendTelegramAlert(botToken, chatId, message) {
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    });
  } catch (e) {
    console.error('[signalEvolution] Telegram failed:', e.message);
  }
}

function formatSignalAlert(signal, project) {
  const phaseEmoji = ['', '🔵', '🟡', '🟠', '🔴'][signal.phase] || '⚡';
  const severityEmoji = signal.severity === 'HIGH' ? '🚨' : '⚠️';

  const lines = [
    `${phaseEmoji} *PHASE ${signal.phase} SIGNAL* — ${project?.name || 'Token'}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `${severityEmoji} *${signal.type.replace(/_/g, ' ')}*`,
    ``,
    `📋 ${signal.summary}`,
    ``,
    `💡 _${signal.interpretation}_`,
  ];

  if (signal.walletCount) lines.push(`👥 Wallets involved: *${signal.walletCount}*`);
  if (signal.totalVolume) lines.push(`📊 Volume: *${(signal.totalVolume / 1e6).toFixed(2)}M tokens*`);
  if (signal.avgSmartScore) lines.push(`🧠 Avg smart score: *${signal.avgSmartScore}*`);
  if (signal.dominance) lines.push(`🐋 Wallet dominance: *${Math.round(signal.dominance * 100)}%*`);

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🕐 ${new Date(signal.timestamp).toLocaleTimeString()}`);

  return lines.join('\n');
}

async function evolveSignals(mint) {
  const signals = getSignals(mint, 50);
  if (signals.length < 2) return;

  const now = Date.now();
  const newEvolutions = [];

  for (const rule of UPGRADE_RULES) {
    const triggers = signals.filter(s =>
      s.type === rule.trigger &&
      !evolved.has(s.id)
    );

    for (const trigger of triggers) {
      const confirming = signals.find(s =>
        s.type === rule.confirms &&
        s.timestamp > trigger.timestamp &&
        s.timestamp <= trigger.timestamp + rule.windowMs
      );

      if (confirming) {
        evolved.add(trigger.id);

        const evolution = {
          ...trigger,
          ...rule.upgradeTo,
          type: rule.upgradeTo.label,
          evolvedFrom: [trigger.type, confirming.type],
          evolvedAt: now,
          mint,
        };

        newEvolutions.push(evolution);
        console.log(`[signalEvolution] ${trigger.type} → ${rule.upgradeTo.label} (Phase ${rule.upgradeTo.phase})`);
      }
    }
  }

  if (newEvolutions.length > 0) {
    await fireEvolutionAlerts(mint, newEvolutions);
  }

  return newEvolutions;
}

async function fireEvolutionAlerts(mint, evolutions) {
  try {
    const result = await pool.query(
      'SELECT * FROM projects WHERE mint_address = $1',
      [mint]
    );

    for (const project of result.rows) {
      if (!project.telegram_bot_token || !project.telegram_group_id) continue;

      for (const signal of evolutions) {
        const msg = formatSignalAlert(signal, project);
        await sendTelegramAlert(
          project.telegram_bot_token,
          project.telegram_group_id,
          msg
        );
        await new Promise(r =>
