-- ============================================
-- SUPABASE DATABASE SCHEMA
-- ============================================
-- This is for reference only - your Supabase
-- should already have these tables.
-- Only run this if starting completely fresh.
-- ============================================

-- 1. Policies Table
CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT UNIQUE NOT NULL,
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

-- ============================================
-- ENABLE REAL-TIME (if needed)
-- ============================================

-- Run these in Supabase Dashboard > Database > Replication
-- ALTER PUBLICATION supabase_realtime ADD TABLE payment_history;
-- ALTER PUBLICATION supabase_realtime ADD TABLE daily_spending;
-- ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
