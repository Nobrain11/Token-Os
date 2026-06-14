require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
const API = process.env.BACKEND_URL || 'http://localhost:3001';

// /start
bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `⚡ *Token OS Bot*\n\nYour token project command center.\n\n` +
    `*Commands:*\n` +
    `/project <mint> — Set your active token\n` +
    `/holders — Live holder count\n` +
    `/top — Top 10 holders\n` +
    `/overview — Full token overview\n` +
    `/burns — Recent burn transactions\n` +
    `/milestone <holders|burn> <value> — Set an alert\n` +
    `/dashboard — Link to web dashboard\n`
  );
});

// Store active project per chat
const chatProjects = {};

// /project <mint>
bot.command('project', async (ctx) => {
  const mint = ctx.message.text.split(' ')[1];
  if (!mint) return ctx.reply('Usage: /project <mint_address>');

  ctx.reply('🔍 Looking up token...');
  try {
    const res = await axios.post(`${API}/api/projects/register`, {
      name: 'My Token',
      mintAddress: mint,
      ownerWallet: 'telegram_user'
    });

    chatProjects[ctx.chat.id] = res.data.project.id;
    const meta = res.data.metadata;

    ctx.replyWithMarkdown(
      `✅ *Token Registered*\n\n` +
      `*Name:* ${meta?.name || 'Unknown'}\n` +
      `*Symbol:* ${meta?.symbol || '???'}\n` +
      `*Mint:* \`${mint}\`\n\n` +
      `Use /overview to see full stats.`
    );
  } catch (err) {
    ctx.reply('❌ Failed to register token. Check the mint address.');
  }
});

// /holders
bot.command('holders', async (req, ctx) => {
  const projectId = chatProjects[ctx?.chat?.id];
  if (!projectId) return ctx.reply('First set a token with /project <mint>');

  ctx.reply('⏳ Fetching holders...');
  try {
    const res = await axios.get(`${API}/api/projects/${projectId}/holders`);
    ctx.replyWithMarkdown(
      `👥 *Holder Count*\n\n` +
      `*Total Holders:* ${res.data.totalHolders.toLocaleString()}\n\n` +
      `_Updated just now_`
    );
  } catch (err) {
    ctx.reply('❌ Failed to fetch holders.');
  }
});

// /top
bot.command('top', async (ctx) => {
  const projectId = chatProjects[ctx.chat.id];
  if (!projectId) return ctx.reply('First set a token with /project <mint>');

  ctx.reply('⏳ Fetching top holders...');
  try {
    const res = await axios.get(`${API}/api/projects/${projectId}/holders`);
    const top = res.data.topHolders.slice(0, 10);

    let msg = `🏆 *Top 10 Holders*\n\n`;
    top.forEach((h) => {
      const short = `${h.wallet.slice(0, 4)}...${h.wallet.slice(-4)}`;
      msg += `*#${h.rank}* \`${short}\` — ${h.uiAmount.toLocaleString()} tokens\n`;
    });

    ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ Failed to fetch top holders.');
  }
});

// /overview
bot.command('overview', async (ctx) => {
  const projectId = chatProjects[ctx.chat.id];
  if (!projectId) return ctx.reply('First set a token with /project <mint>');

  ctx.reply('⏳ Loading overview...');
  try {
    const res = await axios.get(`${API}/api/projects/${projectId}/overview`);
    const { metadata, price, holderCount, topHolders } = res.data;

    let msg = `📊 *Token Overview*\n\n`;
    msg += `*Name:* ${metadata?.name || 'Unknown'}\n`;
    msg += `*Symbol:* ${metadata?.symbol || '???'}\n`;
    msg += `*Price:* ${price ? `$${price.toFixed(8)}` : 'N/A'}\n`;
    msg += `*Holders:* ${holderCount?.toLocaleString() || 'N/A'}\n\n`;
    msg += `*Top 5 Holders:*\n`;
    topHolders?.forEach((h) => {
      msg += `• \`${h.wallet.slice(0, 6)}...\` — ${h.uiAmount.toLocaleString()}\n`;
    });

    ctx.replyWithMarkdown(msg);
  } catch (err) {
    ctx.reply('❌ Failed to load overview.');
  }
});

// /milestone holders 1000
bot.command('milestone', async (ctx) => {
  const projectId = chatProjects[ctx.chat.id];
  if (!projectId) return ctx.reply('First set a token with /project <mint>');

  const parts = ctx.message.text.split(' ');
  const type = parts[1];
  const value = parts[2];

  if (!type || !value) return ctx.reply('Usage: /milestone holders 1000');

  try {
    await axios.post(`${API}/api/projects/${projectId}/milestones`, {
      type,
      targetValue: Number(value)
    });
    ctx.replyWithMarkdown(`✅ *Milestone Set*\nAlert when ${type} reaches *${Number(value).toLocaleString()}*`);
  } catch (err) {
    ctx.reply('❌ Failed to set milestone.');
  }
});

// /dashboard
bot.command('dashboard', (ctx) => {
  const dashUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.com';
  ctx.replyWithMarkdown(
    `🖥️ *Token OS Dashboard*\n\n[Open Dashboard](${dashUrl})\n\nManage holders, airdrops, milestones and more.`
  );
});

bot.launch();
console.log('Token OS Bot running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
