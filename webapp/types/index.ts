// webapp/types/index.ts
// TypeScript types for x402-Policy-Manager

export interface Policy {
  id: string;
  agent_address: string;
  owner_address: string;
  daily_limit_sol: number;
  daily_limit_usdc: number;
  per_tx_limit_sol: number;
  per_tx_limit_usdc: number;
  is_active: boolean;
  is_paused: boolean;
  is_revoked: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailySpending {
  id: string;
  agent_address: string;
  day: string;
  sol_spent: number;
  usdc_spent: number;
  updated_at: string;
}

export interface ApprovedService {
  id: string;
  agent_address: string;
  service_url: string;
  approved: boolean;
  created_at: string;
}

export interface ApprovedFacilitator {
  id: string;
  agent_address: string;
  facilitator_address: string;
  approved: boolean;
  created_at: string;
}

export interface PaymentHistory {
  id: string;
  agent_address: string;
  amount: number;
  asset_type: 'SOL' | 'USDC';
  service_url: string;
  transaction_id: string | null;
  approved: boolean;
  block_height: number | null;
  created_at: string;
}

export interface Session {
  id: string;
  session_id: string;
  agent_address: string;
  owner_address: string;
  budget_sol: number;
  budget_usdc: number;
  spent_sol: number;
  spent_usdc: number;
  is_active: boolean;
  payment_count: number;
  expires_at: string;
  created_at: string;
}

export interface CreatePolicyInput {
  agent_address: string;
  daily_limit_sol: number;
  daily_limit_usdc: number;
  per_tx_limit_sol: number;
  per_tx_limit_usdc: number;
}

export interface UpdatePolicyInput {
  daily_limit_sol?: number;
  daily_limit_usdc?: number;
  per_tx_limit_sol?: number;
  per_tx_limit_usdc?: number;
}

export interface CreateSessionInput {
  agent_address: string;
  budget_sol: number;
  budget_usdc: number;
  timeout_hours: number;
}

export interface PaymentValidationResult {
  allowed: boolean;
  reason?: string;
  checks: {
    agentActive: boolean;
    withinPerTxLimit: boolean;
    withinDailyLimit: boolean;
    serviceApproved: boolean;
    facilitatorApproved: boolean;
  };
}

export interface WalletInfo {
  address: string;
  network: 'mainnet' | 'testnet';
  publicKey: string;
}

export interface ContractCallResult {
  success: boolean;
  txId?: string;
  error?: string;
}

// Stacks-specific types
export interface StacksTransaction {
  txId: string;
  sender: string;
  fee: number;
  nonce: number;
  txStatus: 'pending' | 'success' | 'failed';
}

// x402 payment types
export interface X402PaymentRequest {
  amount: number;
  asset: 'SOL' | 'USDC';
  service: string;
  facilitator: string;
}

export interface X402PaymentResponse {
  success: boolean;
  transaction?: string;
  payer?: string;
  network?: string;
  errorReason?: string;
}

// Dashboard stats
export interface DashboardStats {
  totalPolicies: number;
  activeSessions: number;
  paymentsToday: number;
  totalSpentToday: {
    sol: number;
    usdc: number;
  };
  recentPayments: PaymentHistory[];
}

// Chart data
export interface ChartDataPoint {
  date: string;
  sol: number;
  usdc: number;
}

// Notification types
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Form validation
export interface ValidationError {
  field: string;
  message: string;
}

// Utility types
export type AssetType = 'SOL' | 'USDC';
export type NetworkType = 'mainnet' | 'testnet';
export type AgentStatus = 'active' | 'paused' | 'revoked';