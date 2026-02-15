-- Setup agent for n8n workflow testing
-- Run this in your Supabase SQL editor
-- 
-- INSTRUCTIONS: Replace the variables below with your values
-- Then run the script

-- ==================== CONFIGURATION ====================
-- Change these values for your agent
DO $$
DECLARE
  v_agent_address TEXT := 'YOUR_AGENT_ADDRESS_HERE';  -- Replace with your Stacks address
  v_service_url TEXT := 'https://wttr.in';             -- Replace with service you want to approve
  v_daily_limit_stx BIGINT := 10000000;               -- 10 STX (in microSTX)
  v_daily_limit_sbtc BIGINT := 100000000;             -- 1 BTC (in satoshis)
  v_per_tx_limit_stx BIGINT := 1000000;               -- 1 STX per transaction
  v_per_tx_limit_sbtc BIGINT := 10000000;             -- 0.1 BTC per transaction
BEGIN

-- =======================================================
-- 1. Create a policy for your agent (if not exists)
-- =======================================================
INSERT INTO policies (
  agent_address,
  daily_limit_stx,
  daily_limit_sbtc,
  per_tx_limit_stx,
  per_tx_limit_sbtc,
  is_active,
  is_paused,
  is_revoked
) VALUES (
  v_agent_address,
  v_daily_limit_stx,
  v_daily_limit_sbtc,
  v_per_tx_limit_stx,
  v_per_tx_limit_sbtc,
  true,
  false,
  false
)
ON CONFLICT (agent_address) DO UPDATE SET
  daily_limit_stx = EXCLUDED.daily_limit_stx,
  daily_limit_sbtc = EXCLUDED.daily_limit_sbtc,
  per_tx_limit_stx = EXCLUDED.per_tx_limit_stx,
  per_tx_limit_sbtc = EXCLUDED.per_tx_limit_sbtc,
  is_active = true;

RAISE NOTICE '✓ Policy created/updated for: %', v_agent_address;

-- =======================================================
-- 2. Approve service for this agent
-- =======================================================
INSERT INTO approved_services (
  agent_address,
  service_url,
  approved
) VALUES (
  v_agent_address,
  v_service_url,
  true
)
ON CONFLICT (agent_address, service_url) DO UPDATE SET approved = true;

RAISE NOTICE '✓ Service approved: %', v_service_url;

END $$;

-- =======================================================
-- 3. Verify setup
-- =======================================================
-- Check if policy exists
SELECT 
  'POLICY' as type,
  agent_address,
  daily_limit_stx / 1000000.0 as daily_limit_stx,
  per_tx_limit_stx / 1000000.0 as per_tx_limit_stx,
  is_active,
  is_paused,
  is_revoked
FROM policies 
WHERE agent_address = 'YOUR_AGENT_ADDRESS_HERE';  -- Update this

-- Check approved services
SELECT 
  'APPROVED SERVICE' as type,
  agent_address,
  service_url,
  approved
FROM approved_services 
WHERE agent_address = 'YOUR_AGENT_ADDRESS_HERE';  -- Update this

-- =======================================================
-- QUICK REFERENCE:
-- =======================================================
-- STX amounts (in microSTX, 1 STX = 1,000,000 microSTX):
--   1 STX = 1000000
--   10 STX = 10000000
--   100 STX = 100000000
-- 
-- BTC amounts (in satoshis, 1 BTC = 100,000,000 satoshis):
--   0.01 BTC = 1000000
--   0.1 BTC = 10000000
--   1 BTC = 100000000
--
-- Common services to approve:
--   https://wttr.in (weather)
--   https://api.openai.com (OpenAI)
--   https://api.anthropic.com (Anthropic)
--   http://localhost:3001 (local dev)
-- =======================================================
