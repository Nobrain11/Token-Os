# TOKEN OS — Token Project Command Center

A full-stack platform for Solana token projects. Holder analytics, milestone alerts, airdrop tool, and Telegram bot — all in one.

## Structure

```
token-os/
├── backend/          # Express API + Helius integration
├── bot/              # Telegraf Telegram bot
└── frontend/         # Single-file HTML dashboard
    └── public/
        └── index.html
```

## Quick Deploy (Railway)

### 1. Backend

1. Push `backend/` folder to a GitHub repo
1. Go to Railway → New Project → Deploy from GitHub
1. Add environment variables:
   
   ```
   HELIUS_API_KEY=e7ecd396-ff39-410e-82d1-90db67981793
   DATABASE_URL=<from Railway Postgres plugin>
   FEE_WALLET=<your Solana wallet to collect fees + subscriptions>
   PORT=3001
   NODE_ENV=production
   WEBHOOK_BASE_URL=https://<your-railway-url>.railway.app
   SUBSCRIPTION_PRICE_SOL=1
   SUBSCRIPTION_DAYS=30
   ```
1. Add PostgreSQL plugin in Railway
1. Run schema: connect to DB and paste contents of `schema.sql`

### 2. Bot

1. Push `bot/` to a separate GitHub repo (or same monorepo)
1. New Railway service → point to bot/
1. Add:
   
   ```
   BOT_TOKEN=<your Telegram bot token from @BotFather>
   BACKEND_URL=https://<backend-railway-url>.railway.app
   DASHBOARD_URL=https://<your-dashboard-url>
   ```

### 3. Dashboard

Option A — Netlify (free):

- Drag `frontend/public/` folder to netlify.com/drop
- Update `API` variable in `index.html` to your Railway backend URL

Option B — Railway Static:

- Deploy `frontend/` as a static service

## API Endpoints

```
POST /api/projects/register         — Register token project
GET  /api/projects/by-wallet/:wallet — Get user's projects
GET  /api/projects/:id/overview     — Token stats + price + holders
GET  /api/projects/:id/holders      — Live holder snapshot
GET  /api/projects/:id/holders/history — Growth over time
POST /api/projects/:id/milestones   — Set milestone alert
POST /api/projects/:id/telegram     — Connect Telegram group
POST /api/airdrops/:id/preview      — Preview airdrop distribution (requires active subscription/trial)
POST /api/airdrops/:id/record       — Record completed airdrop (requires active subscription/trial)
POST /webhooks/helius               — Helius webhook receiver
GET  /api/subscriptions/:id/status         — Current plan status, days left
POST /api/subscriptions/:id/create-payment — Generate Solana Pay QR + URL
GET  /api/subscriptions/:id/verify/:ref    — Check chain & activate subscription
```

## Bot Commands

```
/project <mint>       — Register/set active token
/holders              — Live holder count
/top                  — Top 10 holders
/overview             — Full token stats
/milestone <type> <value> — Set alert
/dashboard            — Link to web dashboard
```

## Monetization

- **Solana Pay subscriptions:** every project gets a 7-day free trial, then needs an active subscription to use the airdrop tool. Price/duration set via `SUBSCRIPTION_PRICE_SOL` and `SUBSCRIPTION_DAYS` env vars (default 1 SOL / 30 days — adjust to match $99-299/mo at current SOL price)
- Token devs pay by scanning a QR code (Phantom/Solflare) — payment is verified directly on-chain via Helius RPC, no card processor needed
- **Airdrop fee:** 1% of every airdrop processed is sent to `FEE_WALLET` automatically
- Holder analytics, milestones, and Telegram alerts remain free during trial to drive adoption; airdrop tool is the paywalled feature

## Tech Stack

- **Backend:** Node.js + Express + PostgreSQL
- **On-chain data:** Helius API (webhooks + RPC)
- **Price data:** Jupiter Price API v2
- **Bot:** Telegraf
- **Frontend:** Vanilla HTML/CSS/JS (no build step needed)
- **Deploy:** Railway
