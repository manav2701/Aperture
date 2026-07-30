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
  daily_limit_sol BIGINT DEFAULT 10000000,
  daily_limit_usdc BIGINT DEFAULT 100000000,
  per_tx_limit_sol BIGINT DEFAULT 1000000,
  per_tx_limit_usdc BIGINT DEFAULT 10000000,
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
  asset_type TEXT DEFAULT 'SOL',
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
  sol_spent BIGINT DEFAULT 0,
  usdc_spent BIGINT DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, day)
);

-- 9. Aperture v3 Orgs Table
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_pda TEXT UNIQUE NOT NULL,
  owner_address TEXT NOT NULL,
  name TEXT NOT NULL,
  global_daily_cap_sol NUMERIC DEFAULT 1000,
  global_monthly_cap_sol NUMERIC DEFAULT 10000,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Aperture v3 Teams Table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_pda TEXT UNIQUE NOT NULL,
  org_pda TEXT REFERENCES orgs(org_pda) ON DELETE CASCADE,
  team_id INT NOT NULL,
  name TEXT NOT NULL,
  team_lead_address TEXT NOT NULL,
  team_daily_cap_sol NUMERIC DEFAULT 500,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Aperture v3 Org Members Table
CREATE TABLE IF NOT EXISTS org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_pda TEXT UNIQUE NOT NULL,
  org_pda TEXT REFERENCES orgs(org_pda) ON DELETE CASCADE,
  member_address TEXT NOT NULL,
  role INT NOT NULL DEFAULT 3, -- 0=Owner, 1=CFO, 2=TeamLead, 3=Developer, 4=Auditor
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(org_pda, member_address)
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
  budget_sol BIGINT DEFAULT 0,
  budget_usdc BIGINT DEFAULT 0,
  spent_sol BIGINT DEFAULT 0,
  spent_usdc BIGINT DEFAULT 0,
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
  p_sol_amount BIGINT DEFAULT 0,
  p_usdc_amount BIGINT DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO daily_spending (agent_address, day, sol_spent, usdc_spent)
  VALUES (p_agent_address, p_day, p_sol_amount, p_usdc_amount)
  ON CONFLICT (agent_address, day)
  DO UPDATE SET
    sol_spent = daily_spending.sol_spent + p_sol_amount,
    usdc_spent = daily_spending.usdc_spent + p_usdc_amount,
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
  daily_limit_sol BIGINT NOT NULL,
  daily_limit_usdc BIGINT NOT NULL,
  per_tx_limit_sol BIGINT NOT NULL,
  per_tx_limit_usdc BIGINT NOT NULL,
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
  sol_spent BIGINT DEFAULT 0,
  usdc_spent BIGINT DEFAULT 0,
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
  asset_type TEXT NOT NULL, -- 'SOL' or 'USDC'
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
  budget_sol BIGINT DEFAULT 0,
  budget_usdc BIGINT DEFAULT 0,
  spent_sol BIGINT DEFAULT 0,
  spent_usdc BIGINT DEFAULT 0,
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



-- Drop old function and create improved version (handles both SOL and USDC)
DROP FUNCTION IF EXISTS increment_daily_spending(TEXT, DATE, BIGINT);

CREATE OR REPLACE FUNCTION increment_daily_spending(
  p_agent_address TEXT,
  p_day DATE,
  p_sol_amount BIGINT DEFAULT 0,
  p_usdc_amount BIGINT DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO daily_spending (agent_address, day, sol_spent, usdc_spent)
  VALUES (p_agent_address, p_day, p_sol_amount, p_usdc_amount)
  ON CONFLICT (agent_address, day)
  DO UPDATE SET
    sol_spent = daily_spending.sol_spent + p_sol_amount,
    usdc_spent = daily_spending.usdc_spent + p_usdc_amount,
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

-- ============================================
-- APERTURE GOVERNED LLM GATEWAY TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS models (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  company_id INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_provider_mappings (
  id SERIAL PRIMARY KEY,
  model_id INT REFERENCES models(id),
  provider_id INT REFERENCES providers(id),
  input_token_cost INT NOT NULL,
  output_token_cost INT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_virtual_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT NOT NULL,
  virtual_api_key TEXT UNIQUE NOT NULL, -- aptr_live_...
  daily_limit_usd NUMERIC DEFAULT 100.0,
  per_tx_limit_usd NUMERIC DEFAULT 10.0,
  monthly_limit_usd NUMERIC DEFAULT 2000.0,
  velocity_max_per_hour INT DEFAULT 60,
  escalation_threshold_usd NUMERIC,
  allowed_hours_start INT,
  allowed_hours_end INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_model_allowlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT NOT NULL,
  model_slug TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_address, model_slug)
);

CREATE TABLE IF NOT EXISTS agent_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_address TEXT NOT NULL,
  virtual_api_key TEXT NOT NULL,
  model_slug TEXT NOT NULL,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd NUMERIC DEFAULT 0.0,
  status TEXT NOT NULL, -- APPROVED, BLOCKED_*, ESCALATED_*
  blocked_reason TEXT,
  escalated BOOLEAN DEFAULT false,
  approved_by TEXT,
  tx_signature TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_address ON agent_request_logs(agent_address);
CREATE INDEX IF NOT EXISTS idx_agent_logs_status ON agent_request_logs(status);
CREATE INDEX IF NOT EXISTS idx_agent_keys_virtual ON agent_virtual_keys(virtual_api_key);


