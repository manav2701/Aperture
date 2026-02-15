-- ============================================
-- DATABASE SCHEMA UPDATE FOR REAL AGENT WALLETS
-- ============================================
-- Run this in Supabase SQL Editor to add mnemonic storage
-- ============================================

-- Add mnemonic column to policies table (stores recovery phrase)
ALTER TABLE policies 
ADD COLUMN IF NOT EXISTS agent_mnemonic TEXT;

-- Add comment
COMMENT ON COLUMN policies.agent_mnemonic IS 'BIP39 mnemonic for agent wallet recovery - KEEP SECURE!';

-- ⚠️ SECURITY WARNING:
-- In production, mnemonics should be:
-- 1. Encrypted at rest (use pgcrypto)
-- 2. Stored in separate secure vault (HashiCorp Vault, AWS KMS)
-- 3. Never exposed via API
-- 
-- For hackathon demo, we're storing plain text for easy recovery
-- DO NOT use this in production!

-- Optional: Create view without mnemonics for public API
CREATE OR REPLACE VIEW policies_public AS
SELECT 
  id,
  agent_address,
  owner_address,
  daily_limit_stx,
  daily_limit_sbtc,
  per_tx_limit_stx,
  per_tx_limit_sbtc,
  is_active,
  is_paused,
  is_revoked,
  created_at,
  updated_at
FROM policies;

-- Grant access
GRANT SELECT ON policies_public TO anon, authenticated;
