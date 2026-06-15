require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://token-os-kv33.vercel.app';

if (!BOT_TOKEN) { console.error('BOT_TOKEN is required'); process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// ── SESSION ──────────────────────────────────────────────────────────────────
bot.use(session());
function ctx_session(ctx) {
  if (!ctx.session) ctx.session = {};
  return ctx.session;
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
const line  = '━━━━━━━━━━━━━━━━━━━━━━';
const dline = '══════════════════════';

function fmt(val, fallback = 'N/A') {
  return val !== null && val !== undefined ? val : fallback;
}

function fmtPrice(p) {
  if (!p) return 'N/A';
  const n = Number(p);
  if (n < 0.000001) return `$${n.toExponential(4)}`;
  if (n < 0.01) return `$${n.toFixed(8)}`;
  return `$${n.toFixed(4)}`;
}

function fmtNum(n) {
  return Number(n).toLocaleString();
}

function shortWallet(w) {
  if (!w) return 'N/A';
  return `${w.slice(0,6)}...${w.slice(-4)}`;
}

function mainKeyboard(hasProject) {
  if (!hasProject) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📋 Register Token', 'cmd_register')],
      [Markup.button.url('🖥 Open Dashboard', DASHBOARD_URL)]
    ]);
  }
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('👥 Holders', 'cmd_holders'),
      Markup.button.callback('📈 Overview', 'cmd_overview')
    ],
    [
      Markup.button.callback('🏆 Top 10', 'cmd_top'),
      Markup.button.callback('🎯 Milestones', 'cmd_milestones')
    ],
    [
      Markup.button.callback('💸 Airdrop', 'cmd_airdrop'),
      Markup.button.callback('⚙️ Settings', 'cmd_settings')
    ],
    [Markup.button.url('🖥 Dashboard', DASHBOARD_URL)]
  ]);
}

async function getProject(ctx) {
  const session = ctx_session(ctx);
  return session.project || null;
}

async function requireProject(ctx) {
  const proj = await getProject(ctx);
  if (!proj) {
    await ctx.reply(
      `⚠️ *No project loaded*\n\n${line}\nUse /project <mint> to register your token first.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 How to register', 'cmd_register')],
          [Markup.button.url('🖥 Open Dashboard', DASHBOARD_URL)]
        ])
      }
    );
    return null;
  }
  return proj;
}

// ── /start ───────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const name = ctx.from.first_name || 'dev';
  await ctx.replyWithMarkdown(
    `${dline}\n` +
    `⚡ *TOKEN OS*\n` +
    `${dline}\n\n` +
    `Welcome, *${name}*\\.\n\n` +
    `Your Solana token command center\\.\n` +
    `Holder analytics, whale alerts, airdrops & Telegram automation — live from chain\\.\n\n` +
    `${line}\n` +
    `🚀 *Get started:*\n` +
    `Register your token with:\n` +
    `\`/project <mint_address>\`\n\n` +
    `Or open the dashboard to manage everything visually\\.\n` +
    `${line}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📋 How to register', 'cmd_register')],
      [Markup.button.callback('📖 All Commands', 'cmd_help')],
      [Markup.button.url('🖥 Open Dashboard', DASHBOARD_URL)]
    ])
  );
});

// ── /help ────────────────────────────────────────────────────────────────────
bot.help(async (ctx) => {
  await ctx.replyWithMarkdown(
    `${dline}\n` +
    `📖 *TOKEN OS — COMMANDS*\n` +
    `${dline}\n\n` +
    `*Token Setup*\n` +
    `├ /project \\<mint\\> — Load token\n` +
    `└ /me — Show active project\n\n` +
    `*Analytics*\n` +
    `├ /overview — Price \\+ holders \\+ top 3\n` +
    `├ /holders — Live holder count\n` +
    `├ /top — Top 10 holders\n` +
    `└ /stats — Full token stats card\n\n` +
    `*Alerts*\n` +
    `├ /milestone \\<type\\> \\<value\\> — Set alert\n` +
    `├ /milestones — View all alerts\n` +
    `└ /alert — Quick alert menu\n\n` +
    `*Airdrops*\n` +
    `└ /airdrop \\<sol\\> — Preview distribution\n\n` +
    `*Other*\n` +
    `└ /dashboard — Open web dashboard\n\n` +
    `${line}`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('👥 Holders', 'cmd_holders'),
        Markup.button.callback('📈 Overview', 'cmd_overview')
      ],
      [
        Markup.button.callback('🎯 Set Alert', 'cmd_alert'),
        Markup.button.callback('💸 Airdrop', 'cmd_airdrop')
      ],
      [Markup.button.url('🖥 Dashboard', DASHBOARD_URL)]
    ])
  );
});

// ── /project <mint> ──────────────────────────────────────────────────────────
bot.command('project', async (ctx) => {
  const mint = ctx.message.text.split(' ')[1]?.trim();

  if (!mint) {
    return ctx.replyWithMarkdown(
      `*Register a Token*\n\n${line}\nUsage:\n\`/project <mint_address>\`\n\nExample:\n\`/project Htg5dsESFUSRdtNQ42JCgkUx5ikH6sK54nfkWFVdpump\``,
      Markup.inlineKeyboard([[Markup.button.url('🖥 Use Dashboard Instead', DASHBOARD_URL)]])
    );
  }

  const msg = await ctx.reply('🔍 Loading token...');

  try {
    const res = await axios.post(`${BACKEND}/api/projects/register`, {
      name: `Project ${mint.slice(0, 6)}`,
      mintAddress: mint,
      ownerWallet: ctx.from.id.toString()
    });

    ctx_session(ctx).project = res.data;

    // Fetch overview immediately
    let overviewText = '';
    try {
      const ov = await axios.get(`${BACKEND}/api/projects/${res.data.id}/overview`);
      const { metadata, price, holderCount } = ov.data;
      overviewText =
        `\n${line}\n` +
        `🪙 *${metadata?.name || 'Unknown'} \\(${metadata?.symbol || '???'}\\)*\n` +
        `👥 Holders: *${fmtNum(holderCount)}*\n` +
        `💵 Price: *${fmtPrice(price)}*\n`;
    } catch {}

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `${dline}\n✅ *PROJECT LOADED*\n${dline}\n\n` +
      `📍 Mint: \`${shortWallet(mint)}\`${overviewText}\n${line}`,
      {
        parse_mode: 'Markdown',
        ...mainKeyboard(true)
      }
    );
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Failed to load project*\n\n${line}\n${e.response?.data?.error || e.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /me ──────────────────────────────────────────────────────────────────────
bot.command('me', async (ctx) => {
  const proj = await getProject(ctx);
  if (!proj) return requireProject(ctx);

  await ctx.replyWithMarkdown(
    `${dline}\n🗂 *ACTIVE PROJECT*\n${dline}\n\n` +
    `📛 Name: *${proj.name}*\n` +
    `📍 Mint: \`${proj.mint_address}\`\n` +
    `💳 Plan: *${(proj.subscription_status || 'trial').toUpperCase()}*\n` +
    `📅 Since: *${new Date(proj.created_at).toLocaleDateString()}*\n\n` +
    `${line}`,
    mainKeyboard(true)
  );
});

// ── /overview ────────────────────────────────────────────────────────────────
bot.command('overview', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  const msg = await ctx.reply('📊 Fetching overview...');

  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/overview`);
    const { metadata, price, holderCount, topHolders } = res.data;

    const top3 = (topHolders || []).slice(0, 3).map((h, i) => {
      const medals = ['🥇', '🥈', '🥉'];
      return `${medals[i]} \`${shortWallet(h.wallet)}\` — ${fmtNum(h.uiAmount)}`;
    }).join('\n');

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `${dline}\n📈 *${metadata?.name || proj.name} \\(${metadata?.symbol || '???'}\\)*\n${dline}\n\n` +
      `👥 *Holders:* ${fmtNum(holderCount)}\n` +
      `💵 *Price:* ${fmtPrice(price)}\n\n` +
      `${line}\n` +
      `🏆 *Top Holders*\n` +
      `${line}\n` +
      `${top3 || 'No data'}\n\n` +
      `${line}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Refresh', 'cmd_overview'),
            Markup.button.callback('👥 All Holders', 'cmd_holders')
          ],
          [
            Markup.button.callback('🎯 Set Milestone', 'cmd_alert'),
            Markup.button.url('🖥 Dashboard', DASHBOARD_URL)
          ]
        ])
      }
    );
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Error fetching overview*\n\n${line}\n${e.response?.data?.error || e.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /stats ───────────────────────────────────────────────────────────────────
bot.command('stats', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  const msg = await ctx.reply('📡 Fetching full stats...');

  try {
    const [ovRes, holdRes] = await Promise.all([
      axios.get(`${BACKEND}/api/projects/${proj.id}/overview`),
      axios.get(`${BACKEND}/api/projects/${proj.id}/holders`)
    ]);

    const { metadata, price } = ovRes.data;
    const { totalHolders, topHolders } = holdRes.data;

    const topHolder = topHolders?.[0];
    const topPct = topHolder && metadata?.supply
      ? ((Number(topHolder.uiAmount) / Number(metadata.supply)) * 100).toFixed(2)
      : '?';

    const mcap = price && metadata?.supply
      ? `$${(Number(price) * Number(metadata.supply) / Math.pow(10, metadata.decimals || 6)).toLocaleString(undefined, {maximumFractionDigits: 0})}`
      : 'N/A';

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `${dline}\n📊 *FULL STATS — ${metadata?.symbol || '???'}*\n${dline}\n\n` +
      `🪙 *Token*\n` +
      `├ Name: *${metadata?.name || 'Unknown'}*\n` +
      `├ Symbol: *${metadata?.symbol || '???'}*\n` +
      `└ Decimals: *${metadata?.decimals || 6}*\n\n` +
      `${line}\n` +
      `💹 *Market*\n` +
      `├ Price: *${fmtPrice(price)}*\n` +
      `├ Market Cap: *${mcap}*\n` +
      `└ Supply: *${fmtNum(metadata?.supply || 0)}*\n\n` +
      `${line}\n` +
      `👥 *Holders*\n` +
      `├ Total: *${fmtNum(totalHolders)}*\n` +
      `├ Top Holder: \`${shortWallet(topHolder?.wallet)}\`\n` +
      `└ Top Holder %: *${topPct}%*\n\n` +
      `${line}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Refresh', 'cmd_stats'),
            Markup.button.callback('🏆 Top 10', 'cmd_top')
          ],
          [Markup.button.url('🖥 Full Dashboard', DASHBOARD_URL)]
        ])
      }
    );
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Error*\n\n${e.response?.data?.error || e.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /holders ─────────────────────────────────────────────────────────────────
bot.command('holders', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  const msg = await ctx.reply('⏳ Fetching from chain...');

  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/holders`);
    const { totalHolders } = res.data;

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `${dline}\n👥 *LIVE HOLDER COUNT*\n${dline}\n\n` +
      `🔢 *${fmtNum(totalHolders)}* holders on\\-chain\n\n` +
      `📍 Token: \`${shortWallet(proj.mint_address)}\`\n` +
      `🕐 Updated: *just now*\n\n` +
      `${line}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Refresh', 'cmd_holders'),
            Markup.button.callback('🏆 Top 10', 'cmd_top')
          ],
          [
            Markup.button.callback('🎯 Set Holder Alert', 'alert_holder'),
            Markup.button.url('📊 View Chart', DASHBOARD_URL)
          ]
        ])
      }
    );
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Error*\n\n${e.response?.data?.error || e.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /top ─────────────────────────────────────────────────────────────────────
bot.command('top', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  const msg = await ctx.reply('🔭 Fetching top holders...');

  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/holders`);
    const { topHolders, totalHolders } = res.data;

    const rows = topHolders.slice(0, 10).map((h, i) => {
      const rank = i + 1;
      const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}\\. `;
      const pct = totalHolders ? ((Number(h.uiAmount) / (totalHolders * 1000)) * 100).toFixed(2) : '?';
      return `${emoji} \`${shortWallet(h.wallet)}\`\n    └ ${fmtNum(h.uiAmount)} \\(${pct}%\\)`;
    }).join('\n');

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `${dline}\n🏆 *TOP 10 HOLDERS*\n${dline}\n\n${rows}\n\n${line}\n👥 Total: *${fmtNum(totalHolders)}* holders`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Refresh', 'cmd_top'),
            Markup.button.callback('📈 Overview', 'cmd_overview')
          ],
          [Markup.button.url('🖥 Full Dashboard', DASHBOARD_URL)]
        ])
      }
    );
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Error*\n\n${e.response?.data?.error || e.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /alert (quick milestone menu) ────────────────────────────────────────────
bot.command('alert', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  await ctx.replyWithMarkdown(
    `${dline}\n🎯 *SET MILESTONE ALERT*\n${dline}\n\n` +
    `Choose a preset or set a custom target:\n\n` +
    `${line}`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('👥 100 Holders', 'ms_h_100'),
        Markup.button.callback('👥 500 Holders', 'ms_h_500')
      ],
      [
        Markup.button.callback('👥 1K Holders', 'ms_h_1000'),
        Markup.button.callback('👥 5K Holders', 'ms_h_5000')
      ],
      [
        Markup.button.callback('👥 10K Holders', 'ms_h_10000'),
        Markup.button.callback('👥 100K Holders', 'ms_h_100000')
      ],
      [Markup.button.callback('✏️ Custom Target', 'ms_custom')],
      [Markup.button.callback('📋 View Active Alerts', 'cmd_milestones')]
    ])
  );
});

// ── /milestone ───────────────────────────────────────────────────────────────
bot.command('milestone', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  const args = ctx.message.text.split(' ').slice(1);
  const type = args[0];
  const value = parseFloat(args[1]);

  if (!type || isNaN(value)) {
    return ctx.replyWithMarkdown(
      `${dline}\n🎯 *SET MILESTONE*\n${dline}\n\n` +
      `Usage: \`/milestone <type> <value>\`\n\n` +
      `Types:\n` +
      `• \`holder_count\` — e\\.g\\. /milestone holder_count 1000\n` +
      `• \`price\` — e\\.g\\. /milestone price 0\\.001\n\n` +
      `${line}\n` +
      `Or use the quick menu:`,
      Markup.inlineKeyboard([[Markup.button.callback('🎯 Quick Alert Menu', 'cmd_alert')]])
    );
  }

  try {
    await axios.post(`${BACKEND}/api/projects/${proj.id}/milestones`, {
      type, targetValue: value
    });

    await ctx.replyWithMarkdown(
      `${dline}\n✅ *MILESTONE SET*\n${dline}\n\n` +
      `📌 Type: *${type}*\n` +
      `🎯 Target: *${fmtNum(value)}*\n\n` +
      `You'll get an alert here when it triggers\\.\n\n` +
      `${line}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('➕ Add Another', 'cmd_alert'),
          Markup.button.callback('📋 View All', 'cmd_milestones')
        ]
      ])
    );
  } catch (e) {
    ctx.reply(`❌ Error: ${e.response?.data?.error || e.message}`);
  }
});

// ── /milestones ───────────────────────────────────────────────────────────────
bot.command('milestones', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/milestones`);
    const data = res.data;

    if (!data.length) {
      return ctx.replyWithMarkdown(
        `${dline}\n🎯 *MILESTONES*\n${dline}\n\nNo milestones set yet\\.\n\n${line}`,
        Markup.inlineKeyboard([[Markup.button.callback('➕ Set First Alert', 'cmd_alert')]])
      );
    }

    const rows = data.map(m =>
      `${m.triggered ? '✅' : '👁'} *${m.type}* → \`${fmtNum(m.target_value)}\`${m.triggered ? ' — HIT \\✓' : ''}`
    ).join('\n');

    await ctx.replyWithMarkdown(
      `${dline}\n🎯 *MILESTONES*\n${dline}\n\n${rows}\n\n${line}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('➕ Add Milestone', 'cmd_alert'),
          Markup.button.callback('🔄 Refresh', 'cmd_milestones')
        ]
      ])
    );
  } catch (e) {
    ctx.reply(`❌ Error: ${e.response?.data?.error || e.message}`);
  }
});

// ── /airdrop ─────────────────────────────────────────────────────────────────
bot.command('airdrop', async (ctx) => {
  const proj = await requireProject(ctx);
  if (!proj) return;

  const args = ctx.message.text.split(' ').slice(1);
  const amount = parseFloat(args[0]);

  if (!amount) {
    return ctx.replyWithMarkdown(
      `${dline}\n💸 *AIRDROP TOOL*\n${dline}\n\n` +
      `Usage: \`/airdrop <sol_amount> [topN] [minHolding]\`\n\n` +
      `Examples:\n` +
      `• \`/airdrop 5\` — 5 SOL to all holders\n` +
      `• \`/airdrop 5 100\` — 5 SOL to top 100\n` +
      `• \`/airdrop 5 0 1000\` — holders with ≥1000 tokens\n\n` +
      `${line}\n` +
      `Quick presets:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('💸 1 SOL Drop', 'drop_1'),
          Markup.button.callback('💸 5 SOL Drop', 'drop_5')
        ],
        [
          Markup.button.callback('💸 10 SOL Drop', 'drop_10'),
          Markup.button.callback('💸 Top 100 Only', 'drop_top100')
        ]
      ])
    );
  }

  const topN = parseInt(args[1]) || 0;
  const minHolding = parseInt(args[2]) || 0;
  const msg = await ctx.reply('💸 Calculating distribution...');

  try {
    const res = await axios.post(`${BACKEND}/api/airdrops/${proj.id}/preview`, {
      totalAmount: amount,
      topN: topN || undefined,
      minHolding: minHolding || undefined
    });

    const d = res.data;

    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `${dline}\n💸 *AIRDROP PREVIEW*\n${dline}\n\n` +
      `👥 Recipients: *${fmtNum(d.recipientCount)}*\n` +
      `${line}\n` +
      `💰 Total Amount: *${Number(d.totalAmount).toFixed(4)} SOL*\n` +
      `📊 Platform Fee \\(1%\\): *${Number(d.feeAmount).toFixed(4)} SOL*\n` +
      `✅ Net Distributed: *${Number(d.netAmount).toFixed(4)} SOL*\n` +
      `${line}\n` +
      `📬 Per Wallet: *${Number(d.perWallet).toFixed(6)} SOL*\n\n` +
      `${line}\n` +
      `⚠️ Execute on\\-chain via your connected wallet\\.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Recalculate', 'cmd_airdrop'),
            Markup.button.url('🖥 Execute on Dashboard', DASHBOARD_URL)
          ]
        ])
      }
    );
  } catch (e) {
    await ctx.telegram.editMessageText(
      ctx.chat.id, msg.message_id, null,
      `❌ *Error*\n\n${e.response?.data?.error || e.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /dashboard ───────────────────────────────────────────────────────────────
bot.command('dashboard', async (ctx) => {
  await ctx.replyWithMarkdown(
    `${dline}\n🖥 *TOKEN OS DASHBOARD*\n${dline}\n\nOpen your full command center:`,
    Markup.inlineKeyboard([
      [Markup.button.url('🚀 Open Dashboard', DASHBOARD_URL)],
      [Markup.button.url('⌥ View Source on GitHub', 'https://github.com/Nobrain11/Token-Os')]
    ])
  );
});

// ── CALLBACK QUERIES (button taps) ───────────────────────────────────────────
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery();

  const proj = ctx_session(ctx).project;

  // Navigation
  if (data === 'cmd_help') return ctx.scene ? null : bot.handleUpdate({ ...ctx.update, message: { ...ctx.callbackQuery.message, text: '/help', from: ctx.from, chat: ctx.chat } });
  if (data === 'cmd_overview') return execOverview(ctx, proj);
  if (data === 'cmd_holders') return execHolders(ctx, proj);
  if (data === 'cmd_top') return execTop(ctx, proj);
  if (data === 'cmd_stats') return execStats(ctx, proj);
  if (data === 'cmd_milestones') return execMilestones(ctx, proj);
  if (data === 'cmd_alert') return execAlertMenu(ctx, proj);
  if (data === 'cmd_airdrop') return execAirdropMenu(ctx, proj);
  if (data === 'cmd_settings') return execSettings(ctx, proj);
  if (data === 'cmd_register') return execRegisterHelp(ctx);
  if (data === 'alert_holder') return execAlertMenu(ctx, proj);

  // Milestone presets
  const msMatch = data.match(/^ms_h_(\d+)$/);
  if (msMatch && proj) {
    const target = parseInt(msMatch[1]);
    try {
      await axios.post(`${BACKEND}/api/projects/${proj.id}/milestones`, {
        type: 'holder_count', targetValue: target
      });
      await ctx.editMessageText(
        `${dline}\n✅ *MILESTONE SET*\n${dline}\n\n👥 Alert at *${fmtNum(target)}* holders\n\n${line}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Another', 'cmd_alert'), Markup.button.callback('📋 View All', 'cmd_milestones')]
          ])
        }
      );
    } catch { await ctx.reply('❌ Failed to set milestone'); }
    return;
  }

  if (data === 'ms_custom') {
    return ctx.editMessageText(
      `${dline}\n✏️ *CUSTOM MILESTONE*\n${dline}\n\nSend the command manually:\n\n\`/milestone holder_count 2500\`\nor\n\`/milestone price 0.001\``,
      { parse_mode: 'Markdown' }
    );
  }

  // Airdrop presets
  if (data === 'drop_1') return execAirdropAmount(ctx, proj, 1);
  if (data === 'drop_5') return execAirdropAmount(ctx, proj, 5);
  if (data === 'drop_10') return execAirdropAmount(ctx, proj, 10);
  if (data === 'drop_top100') return execAirdropAmount(ctx, proj, 5, 100);
});

// ── CALLBACK HELPERS ─────────────────────────────────────────────────────────
async function execOverview(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  const msg = await ctx.reply('📊 Fetching...');
  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/overview`);
    const { metadata, price, holderCount, topHolders } = res.data;
    const top3 = (topHolders || []).slice(0, 3).map((h, i) =>
      `${ ['🥇','🥈','🥉'][i]} \`${shortWallet(h.wallet)}\` — ${fmtNum(h.uiAmount)}`
    ).join('\n');
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `${dline}\n📈 *${metadata?.name || proj.name} \\(${metadata?.symbol || '???'}\\)*\n${dline}\n\n` +
      `👥 *Holders:* ${fmtNum(holderCount)}\n💵 *Price:* ${fmtPrice(price)}\n\n${line}\n🏆 *Top Holders*\n${line}\n${top3 || 'No data'}\n\n${line}`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh','cmd_overview'),Markup.button.callback('👥 Holders','cmd_holders')],[Markup.button.url('🖥 Dashboard',DASHBOARD_URL)]]) }
    );
  } catch (e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ ${e.message}`, {parse_mode:'Markdown'}); }
}

async function execHolders(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  const msg = await ctx.reply('⏳ Fetching from chain...');
  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/holders`);
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `${dline}\n👥 *LIVE HOLDER COUNT*\n${dline}\n\n🔢 *${fmtNum(res.data.totalHolders)}* holders on\\-chain\n\n${line}`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh','cmd_holders'),Markup.button.callback('🏆 Top 10','cmd_top')],[Markup.button.callback('🎯 Set Alert','alert_holder'),Markup.button.url('📊 Chart',DASHBOARD_URL)]]) }
    );
  } catch (e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ ${e.message}`, {parse_mode:'Markdown'}); }
}

async function execTop(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  const msg = await ctx.reply('🔭 Fetching top holders...');
  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/holders`);
    const { topHolders, totalHolders } = res.data;
    const rows = topHolders.slice(0,10).map((h,i) => {
      const r = i+1;
      const e = r===1?'🥇':r===2?'🥈':r===3?'🥉':`${r}\\.`;
      return `${e} \`${shortWallet(h.wallet)}\` — ${fmtNum(h.uiAmount)}`;
    }).join('\n');
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `${dline}\n🏆 *TOP 10 HOLDERS*\n${dline}\n\n${rows}\n\n${line}\n👥 Total: *${fmtNum(totalHolders)}*`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh','cmd_top'),Markup.button.url('🖥 Dashboard',DASHBOARD_URL)]]) }
    );
  } catch (e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ ${e.message}`, {parse_mode:'Markdown'}); }
}

async function execStats(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  ctx.message = { text: '/stats', from: ctx.from, chat: ctx.chat };
  // Trigger via reply
  const msg = await ctx.reply('📡 Fetching stats...');
  try {
    const [ovRes, holdRes] = await Promise.all([
      axios.get(`${BACKEND}/api/projects/${proj.id}/overview`),
      axios.get(`${BACKEND}/api/projects/${proj.id}/holders`)
    ]);
    const { metadata, price } = ovRes.data;
    const { totalHolders, topHolders } = holdRes.data;
    const topHolder = topHolders?.[0];
    const mcap = price && metadata?.supply ? `$${(Number(price)*Number(metadata.supply)/Math.pow(10,metadata.decimals||6)).toLocaleString(undefined,{maximumFractionDigits:0})}` : 'N/A';
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `${dline}\n📊 *FULL STATS — ${metadata?.symbol||'???'}*\n${dline}\n\n🪙 *Token*\n├ Name: *${metadata?.name||'Unknown'}*\n└ Symbol: *${metadata?.symbol||'???'}*\n\n${line}\n💹 *Market*\n├ Price: *${fmtPrice(price)}*\n└ Market Cap: *${mcap}*\n\n${line}\n👥 *Holders*\n├ Total: *${fmtNum(totalHolders)}*\n└ Top Wallet: \`${shortWallet(topHolder?.wallet)}\`\n\n${line}`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh','cmd_stats'),Markup.button.callback('🏆 Top 10','cmd_top')],[Markup.button.url('🖥 Dashboard',DASHBOARD_URL)]]) }
    );
  } catch (e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ ${e.message}`, {parse_mode:'Markdown'}); }
}

async function execMilestones(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  try {
    const res = await axios.get(`${BACKEND}/api/projects/${proj.id}/milestones`);
    const data = res.data;
    if (!data.length) {
      return ctx.reply(`${dline}\n🎯 *MILESTONES*\n${dline}\n\nNo milestones set yet\\.`, { parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('➕ Set First Alert','cmd_alert')]]) });
    }
    const rows = data.map(m=>`${m.triggered?'✅':'👁'} *${m.type}* → \`${fmtNum(m.target_value)}\`${m.triggered?' — HIT':''}`).join('\n');
    await ctx.reply(`${dline}\n🎯 *MILESTONES*\n${dline}\n\n${rows}\n\n${line}`,
      { parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('➕ Add','cmd_alert'),Markup.button.callback('🔄 Refresh','cmd_milestones')]]) }
    );
  } catch (e) { ctx.reply(`❌ ${e.message}`); }
}

async function execAlertMenu(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  await ctx.reply(
    `${dline}\n🎯 *SET MILESTONE ALERT*\n${dline}\n\nChoose a holder target:`,
    { parse_mode:'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('👥 100','ms_h_100'),Markup.button.callback('👥 500','ms_h_500')],
      [Markup.button.callback('👥 1K','ms_h_1000'),Markup.button.callback('👥 5K','ms_h_5000')],
      [Markup.button.callback('👥 10K','ms_h_10000'),Markup.button.callback('👥 100K','ms_h_100000')],
      [Markup.button.callback('✏️ Custom Target','ms_custom')],
      [Markup.button.callback('📋 View Active','cmd_milestones')]
    ])}
  );
}

async function execAirdropMenu(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  await ctx.reply(
    `${dline}\n💸 *AIRDROP TOOL*\n${dline}\n\nQuick presets:`,
    { parse_mode:'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('💸 1 SOL','drop_1'),Markup.button.callback('💸 5 SOL','drop_5')],
      [Markup.button.callback('💸 10 SOL','drop_10'),Markup.button.callback('💸 Top 100','drop_top100')],
      [Markup.button.url('🖥 Full Airdrop Tool',DASHBOARD_URL)]
    ])}
  );
}

async function execAirdropAmount(ctx, proj, amount, topN) {
  if (!proj) return noProjectMsg(ctx);
  const msg = await ctx.reply('💸 Calculating...');
  try {
    const res = await axios.post(`${BACKEND}/api/airdrops/${proj.id}/preview`, { totalAmount: amount, topN: topN||undefined });
    const d = res.data;
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null,
      `${dline}\n💸 *AIRDROP PREVIEW*\n${dline}\n\n👥 Recipients: *${fmtNum(d.recipientCount)}*\n${line}\n💰 Total: *${Number(d.totalAmount).toFixed(4)} SOL*\n📊 Fee \\(1%\\): *${Number(d.feeAmount).toFixed(4)} SOL*\n✅ Net: *${Number(d.netAmount).toFixed(4)} SOL*\n${line}\n📬 Per Wallet: *${Number(d.perWallet).toFixed(6)} SOL*\n\n${line}`,
      { parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Recalculate','cmd_airdrop'),Markup.button.url('🖥 Execute',DASHBOARD_URL)]]) }
    );
  } catch (e) { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, `❌ ${e.message}`, {parse_mode:'Markdown'}); }
}

async function execSettings(ctx, proj) {
  if (!proj) return noProjectMsg(ctx);
  await ctx.reply(
    `${dline}\n⚙️ *SETTINGS*\n${dline}\n\n📍 Project: *${proj.name}*\n💳 Plan: *${(proj.subscription_status||'trial').toUpperCase()}*\n\n${line}`,
    { parse_mode:'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Switch Project','cmd_register')],
      [Markup.button.url('⚙️ Full Settings',DASHBOARD_URL)]
    ])}
  );
}

async function execRegisterHelp(ctx) {
  await ctx.reply(
    `${dline}\n📋 *REGISTER A TOKEN*\n${dline}\n\nSend your mint address:\n\n\`/project <mint_address>\`\n\nExample:\n\`/project Htg5ds...pump\`\n\n${line}\nOr use the dashboard:`,
    { parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.url('🖥 Open Dashboard',DASHBOARD_URL)]]) }
  );
}

async function noProjectMsg(ctx) {
  await ctx.reply(
    `⚠️ *No project loaded*\n\n${line}\nUse /project <mint> first\\.`,
    { parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('📋 How to Register','cmd_register')]]) }
  );
}

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[bot] Error for ${ctx.updateType}:`, err.message);
  ctx.reply('⚠️ Something went wrong\\. Try again\\.', { parse_mode: 'Markdown' }).catch(() => {});
});

// ── LAUNCH ───────────────────────────────────────────────────────────────────
bot.launch().then(() => {
  console.log('⚡ TOKEN OS bot running');
}).catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
