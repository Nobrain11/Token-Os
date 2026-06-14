-- Token OS Database Schema

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mint_address TEXT NOT NULL UNIQUE,
  owner_wallet TEXT NOT NULL,
  telegram_group_id TEXT,
  telegram_bot_token TEXT,
  subscription_status TEXT DEFAULT 'trial',
  subscription_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holders_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  holder_count INTEGER,
  top_holders JSONB,
  snapshot_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'holder_count' | 'burn_percent' | 'price'
  target_value NUMERIC NOT NULL,
  triggered BOOLEAN DEFAULT FALSE,
  triggered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS airdrops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  total_amount NUMERIC NOT NULL,
  fee_amount NUMERIC NOT NULL,
  recipient_count INTEGER NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | processing | complete | failed
  tx_signature TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL UNIQUE,
  email TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  amount_sol NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | confirmed
  tx_signature TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP
);
