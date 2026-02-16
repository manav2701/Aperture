-- ============================================
-- SUPABASE DATABASE SCHEMA
-- ============================================
-- This is for reference only - your Supabase
-- should already have these tables.
-- Only run this if starting completely fresh.
-- ============================================

-- 1. Policies Table
-- Complete policies table schema
CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT,                    -- ✅ ADD THIS (was missing)
  agent_address TEXT UNIQUE NOT NULL,
  agent_mnemonic TEXT,                -- For wallet recovery
  owner_address TEXT NOT NULL,
  daily_limit_stx BIGINT DEFAULT 10000000,
  daily_limit_sbtc BIGINT DEFAULT 100000000,
  per_tx_limit_stx BIGINT DEFAULT 1000000,
  per_tx_limit_sbtc BIGINT DEFAULT 10000000,
  is_active BOOLEAN DEFAULT true,
  is_paused BOOLEAN DEFAULT false,
  is_revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Payment History Table
CREATE TABLE IF NOT EXISTS payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT NOT NULL,
  amount BIGINT NOT NULL,
  asset_type TEXT DEFAULT 'STX',
  service_url TEXT NOT NULL,
  approved BOOLEAN DEFAULT true,
  transaction_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Daily Spending Table
CREATE TABLE IF NOT EXISTS daily_spending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT NOT NULL,
  day DATE NOT NULL,
  stx_spent BIGINT DEFAULT 0,
  sbtc_spent BIGINT DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, day)
);

-- 4. Approved Services Table
CREATE TABLE IF NOT EXISTS approved_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT NOT NULL,
  service_url TEXT NOT NULL,
  approved BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, service_url)
);

-- 5. Approved Facilitators Table
CREATE TABLE IF NOT EXISTS approved_facilitators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT NOT NULL,
  facilitator_address TEXT NOT NULL,
  approved BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, facilitator_address)
);

-- 6. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  agent_address TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  budget_stx BIGINT DEFAULT 0,
  budget_sbtc BIGINT DEFAULT 0,
  spent_stx BIGINT DEFAULT 0,
  spent_sbtc BIGINT DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to increment daily spending
CREATE OR REPLACE FUNCTION increment_daily_spending(
  p_agent_address TEXT,
  p_day DATE,
  p_stx_amount BIGINT DEFAULT 0,
  p_sbtc_amount BIGINT DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO daily_spending (agent_address, day, stx_spent, sbtc_spent)
  VALUES (p_agent_address, p_day, p_stx_amount, p_sbtc_amount)
  ON CONFLICT (agent_address, day)
  DO UPDATE SET
    stx_spent = daily_spending.stx_spent + p_stx_amount,
    sbtc_spent = daily_spending.sbtc_spent + p_sbtc_amount,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- INDEXES (for performance)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_policies_agent ON policies(agent_address);
CREATE INDEX IF NOT EXISTS idx_policies_owner ON policies(owner_address);
CREATE INDEX IF NOT EXISTS idx_payments_agent ON payment_history(agent_address);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payment_history(created_at);
CREATE INDEX IF NOT EXISTS idx_daily_spending_agent ON daily_spending(agent_address, day);
CREATE INDEX IF NOT EXISTS idx_services_agent ON approved_services(agent_address);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_address);

ALTER TABLE policies 
ADD COLUMN IF NOT EXISTS agent_mnemonic TEXT;

-- Add comment
COMMENT ON COLUMN policies.agent_mnemonic IS 'BIP39 mnemonic for agent wallet recovery - KEEP SECURE!';

-- ============================================
-- ENABLE REAL-TIME (if needed)
-- ============================================

-- Run these in Supabase Dashboard > Database > Replication
-- ALTER PUBLICATION supabase_realtime ADD TABLE payment_history;
-- ALTER PUBLICATION supabase_realtime ADD TABLE daily_spending;
-- ALTER PUBLICATION supabase_realtime ADD TABLE sessions;



-- Policies table (caches on-chain policy data)
CREATE TABLE policies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_address TEXT NOT NULL UNIQUE,
  owner_address TEXT NOT NULL,
  daily_limit_stx BIGINT NOT NULL,
  daily_limit_sbtc BIGINT NOT NULL,
  per_tx_limit_stx BIGINT NOT NULL,
  per_tx_limit_sbtc BIGINT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  is_paused BOOLEAN DEFAULT false,
  is_revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Daily spending tracker
CREATE TABLE daily_spending (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_address TEXT NOT NULL,
  day DATE NOT NULL,
  stx_spent BIGINT DEFAULT 0,
  sbtc_spent BIGINT DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, day)
);

-- Approved services
CREATE TABLE approved_services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_address TEXT NOT NULL,
  service_url TEXT NOT NULL,
  approved BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, service_url)
);

-- Approved facilitators
CREATE TABLE approved_facilitators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_address TEXT NOT NULL,
  facilitator_address TEXT NOT NULL,
  approved BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, facilitator_address)
);

-- Payment history (for audit trail)
CREATE TABLE payment_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_address TEXT NOT NULL,
  amount BIGINT NOT NULL,
  asset_type TEXT NOT NULL, -- 'STX' or 'sBTC'
  service_url TEXT NOT NULL,
  transaction_id TEXT,
  approved BOOLEAN NOT NULL,
  block_height BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  agent_address TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  budget_stx BIGINT DEFAULT 0,
  budget_sbtc BIGINT DEFAULT 0,
  spent_stx BIGINT DEFAULT 0,
  spent_sbtc BIGINT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  payment_count INTEGER DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_policies_agent ON policies(agent_address);
CREATE INDEX idx_daily_spending_agent_day ON daily_spending(agent_address, day);
CREATE INDEX idx_payment_history_agent ON payment_history(agent_address);
CREATE INDEX idx_sessions_agent ON sessions(agent_address);
CREATE INDEX idx_sessions_session_id ON sessions(session_id);

-- Enable real-time (for dashboard live updates)
ALTER PUBLICATION supabase_realtime ADD TABLE payment_history;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_spending;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;



-- Drop old function and create improved version (handles both STX and sBTC)
DROP FUNCTION IF EXISTS increment_daily_spending(TEXT, DATE, BIGINT);

CREATE OR REPLACE FUNCTION increment_daily_spending(
  p_agent_address TEXT,
  p_day DATE,
  p_stx_amount BIGINT DEFAULT 0,
  p_sbtc_amount BIGINT DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO daily_spending (agent_address, day, stx_spent, sbtc_spent)
  VALUES (p_agent_address, p_day, p_stx_amount, p_sbtc_amount)
  ON CONFLICT (agent_address, day)
  DO UPDATE SET
    stx_spent = daily_spending.stx_spent + p_stx_amount,
    sbtc_spent = daily_spending.sbtc_spent + p_sbtc_amount,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Verify real-time is enabled
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
AND tablename = 'payment_history';


-- Add mnemonic column for real wallet support
ALTER TABLE policies 
ADD COLUMN IF NOT EXISTS agent_mnemonic TEXT;

-- Add comment for security
COMMENT ON COLUMN policies.agent_mnemonic IS 'BIP39 mnemonic for agent wallet recovery - KEEP SECURE!';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS agent_name TEXT;

