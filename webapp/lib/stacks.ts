// webapp/lib/stacks.ts
import { 
  stringAsciiCV, 
  uintCV, 
  principalCV,
  bufferCV,
  PostConditionMode,
  AnchorMode,
  fetchCallReadOnlyFunction,
  cvToJSON,
  makeRandomPrivKey,
  getAddressFromPrivateKey,
} from '@stacks/transactions';
import { STACKS_TESTNET, STACKS_MAINNET } from '@stacks/network';

const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'testnet';
const POLICY_CONTRACT = process.env.NEXT_PUBLIC_POLICY_MANAGER_CONTRACT || '';
const SESSION_CONTRACT = process.env.NEXT_PUBLIC_SESSION_TRACKER_CONTRACT || '';

// Get network instance
export function getNetwork() {
  return NETWORK === 'mainnet' 
    ? STACKS_MAINNET 
    : STACKS_TESTNET;
}

// ============================================================================
// REAL WALLET GENERATION FOR AGENTS
// ============================================================================

export interface AgentWallet {
  address: string;
  mnemonic: string;
  privateKey: string;
  publicKey: string;
}

/**
 * Generate a real Stacks wallet for an AI agent
 * This creates a valid testnet/mainnet address with full keypair
 */
export function generateAgentWallet(): AgentWallet {
  // Generate a random private key using Stacks SDK
  const privateKey = makeRandomPrivKey();
  
  // Determine network (testnet or mainnet)
  const network = process.env.NEXT_PUBLIC_NETWORK || 'testnet';
  const networkObj = network === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET;
  
  // Get the address from the private key using the network object
  const address = getAddressFromPrivateKey(privateKey, networkObj);
  
  // Generate a simple mnemonic representation (note: this is simplified)
  // In production, you'd use proper BIP39 mnemonic generation
  const mnemonic = generateSimpleMnemonic(privateKey);
  
  return {
    address,
    mnemonic,
    privateKey: privateKey,
    publicKey: '', // Public key can be derived if needed
  };
}

/**
 * Generate a simplified 24-word mnemonic from private key
 * NOTE: This is a simplified version for demo purposes
 * In production, use proper BIP39 library for real mnemonic generation
 */
function generateSimpleMnemonic(privateKeyData: string): string {
  // Simple word list (BIP39 compatible subset)
  const words = [
    'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
    'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
    'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
    'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
    'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
    'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
    'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
    'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
    'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
    'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
    'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
    'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
    'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact',
    'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume',
    'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
    'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado',
    'avoid', 'awake', 'aware', 'away', 'awesome', 'awful', 'awkward', 'axis',
    'baby', 'bachelor', 'bacon', 'badge', 'bag', 'balance', 'balcony', 'ball',
    'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain', 'barrel', 'base',
    'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become',
    'beef', 'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt',
    'bench', 'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle',
    'bid', 'bike', 'bind', 'biology', 'bird', 'birth', 'bitter', 'black',
    'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood',
    'blossom', 'blouse', 'blue', 'blur', 'blush', 'board', 'boat', 'body',
    'boil', 'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring',
    'borrow', 'boss', 'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain',
    'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge', 'brief',
    'bright', 'bring', 'brisk', 'broccoli', 'broken', 'bronze', 'broom', 'brother',
    'brown', 'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb',
    'bulk', 'bullet', 'bundle', 'bunker', 'burden', 'burger', 'burst', 'bus',
    'business', 'busy', 'butter', 'buyer', 'buzz', 'cabbage', 'cabin', 'cable'
  ];
  
  // Use private key bytes to generate deterministic word selection
  const mnemonicWords: string[] = [];
  for (let i = 0; i < 24; i++) {
    const index = parseInt(privateKeyData.slice(i * 2, i * 2 + 2), 16) % words.length;
    mnemonicWords.push(words[index]);
  }
  
  return mnemonicWords.join(' ');
}

/**
 * Generate multiple agent wallets at once
 */
export function generateAgentWallets(count: number): AgentWallet[] {
  const wallets: AgentWallet[] = [];
  for (let i = 0; i < count; i++) {
    wallets.push(generateAgentWallet());
  }
  return wallets;
}

// Parse contract identifier (address.contract-name)
export function parseContractId(contractId: string) {
  const [address, name] = contractId.split('.');
  return { address, name };
}

// ============================================================================
// POLICY MANAGER CONTRACT CALLS
// ============================================================================

/**
 * Create a new policy for an agent
 */
export function createPolicy(
  senderAddress: string,
  agentAddress: string,
  dailyLimitStx: number,
  dailyLimitSbtc: number,
  perTxLimitStx: number,
  perTxLimitSbtc: number
) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const functionArgs = [
    principalCV(agentAddress),
    uintCV(dailyLimitStx),
    uintCV(dailyLimitSbtc),
    uintCV(perTxLimitStx),
    uintCV(perTxLimitSbtc),
  ];

  const txOptions = {
    contractAddress,
    contractName,
    functionName: 'create-policy',
    functionArgs,
    senderKey: '', // Will be signed by wallet
    validateWithAbi: true,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Deny,
  };

  return txOptions;
}

/**
 * Update existing policy
 */
export function updatePolicy(
  agentAddress: string,
  dailyLimitStx: number,
  dailyLimitSbtc: number,
  perTxLimitStx: number,
  perTxLimitSbtc: number
) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const functionArgs = [
    principalCV(agentAddress),
    uintCV(dailyLimitStx),
    uintCV(dailyLimitSbtc),
    uintCV(perTxLimitStx),
    uintCV(perTxLimitSbtc),
  ];

  return {
    contractAddress,
    contractName,
    functionName: 'update-policy',
    functionArgs,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Deny,
  };
}

/**
 * Approve a service for an agent
 */
export function approveService(
  agentAddress: string,
  serviceUrl: string
) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const functionArgs = [
    principalCV(agentAddress),
    stringAsciiCV(serviceUrl),
  ];

  return {
    contractAddress,
    contractName,
    functionName: 'approve-service',
    functionArgs,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  };
}

/**
 * Approve a facilitator for an agent
 */
export function approveFacilitator(
  agentAddress: string,
  facilitatorAddress: string
) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const functionArgs = [
    principalCV(agentAddress),
    principalCV(facilitatorAddress),
  ];

  return {
    contractAddress,
    contractName,
    functionName: 'approve-facilitator',
    functionArgs,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  };
}

/**
 * Pause an agent
 */
export async function pauseAgent(agentAddress: string) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const functionArgs = [principalCV(agentAddress)];

  return {
    contractAddress,
    contractName,
    functionName: 'pause-agent',
    functionArgs,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  };
}

/**
 * Unpause an agent
 */
export async function unpauseAgent(agentAddress: string) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const functionArgs = [principalCV(agentAddress)];

  return {
    contractAddress,
    contractName,
    functionName: 'unpause-agent',
    functionArgs,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  };
}

/**
 * Revoke an agent (permanent)
 */
export async function revokeAgent(agentAddress: string) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const functionArgs = [principalCV(agentAddress)];

  return {
    contractAddress,
    contractName,
    functionName: 'revoke-agent',
    functionArgs,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  };
}

// ============================================================================
// READ-ONLY FUNCTIONS
// ============================================================================

/**
 * Get policy for an agent
 */
export async function getPolicy(agentAddress: string) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-policy',
    functionArgs: [principalCV(agentAddress)],
    network: getNetwork(),
    senderAddress: agentAddress,
  });

  return cvToJSON(result);
}

/**
 * Get daily spending for an agent
 */
export async function getDailySpending(agentAddress: string) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-daily-spending',
    functionArgs: [principalCV(agentAddress)],
    network: getNetwork(),
    senderAddress: agentAddress,
  });

  return cvToJSON(result);
}

/**
 * Get agent status (paused/revoked)
 */
export async function getAgentStatus(agentAddress: string) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-agent-status',
    functionArgs: [principalCV(agentAddress)],
    network: getNetwork(),
    senderAddress: agentAddress,
  });

  return cvToJSON(result);
}

/**
 * Check if service is approved
 */
export async function isServiceApproved(agentAddress: string, serviceUrl: string) {
  const { address: contractAddress, name: contractName } = parseContractId(POLICY_CONTRACT);
  
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'is-service-approved',
    functionArgs: [principalCV(agentAddress), stringAsciiCV(serviceUrl)],
    network: getNetwork(),
    senderAddress: agentAddress,
  });

  return cvToJSON(result);
}

// ============================================================================
// SESSION TRACKER FUNCTIONS
// ============================================================================

/**
 * Create a new session
 */
export async function createSession(
  sessionId: string,
  agentAddress: string,
  budgetStx: number,
  budgetSbtc: number,
  timeoutBlocks: number
) {
  const { address: contractAddress, name: contractName } = parseContractId(SESSION_CONTRACT);
  
  // Convert session ID to buffer
  const sessionIdBuffer = Buffer.from(sessionId, 'utf-8');
  
  const functionArgs = [
    bufferCV(sessionIdBuffer),
    principalCV(agentAddress),
    uintCV(budgetStx),
    uintCV(budgetSbtc),
    uintCV(timeoutBlocks),
  ];

  return {
    contractAddress,
    contractName,
    functionName: 'create-session',
    functionArgs,
    network: getNetwork(),
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  };
}

/**
 * Get session details
 */
export async function getSession(sessionId: string, senderAddress: string) {
  const { address: contractAddress, name: contractName } = parseContractId(SESSION_CONTRACT);
  
  const sessionIdBuffer = Buffer.from(sessionId, 'utf-8');
  
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-session',
    functionArgs: [bufferCV(sessionIdBuffer)],
    network: getNetwork(),
    senderAddress,
  });

  return cvToJSON(result);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert STX to microSTX
 */
export function STXtoMicroSTX(stx: number): number {
  return Math.floor(stx * 1_000_000);
}

/**
 * Convert microSTX to STX
 */
export function microSTXtoSTX(microStx: number): number {
  return microStx / 1_000_000;
}

/**
 * Convert satoshis to BTC
 */
export function satoshisToBTC(satoshis: number): number {
  return satoshis / 100_000_000;
}

/**
 * Convert BTC to satoshis
 */
export function BTCtoSatoshis(btc: number): number {
  return Math.floor(btc * 100_000_000);
}

/**
 * Format address (shorten for display)
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Get explorer URL for transaction
 */
export function getExplorerTxUrl(txId: string): string {
  const baseUrl = NETWORK === 'mainnet' 
    ? 'https://explorer.hiro.so/txid'
    : 'https://explorer.hiro.so/txid';
  
  const chain = NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  return `${baseUrl}/${txId}?chain=${chain}`;
}

/**
 * Get explorer URL for address
 */
export function getExplorerAddressUrl(address: string): string {
  const baseUrl = NETWORK === 'mainnet' 
    ? 'https://explorer.hiro.so/address'
    : 'https://explorer.hiro.so/address';
  
  const chain = NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  return `${baseUrl}/${address}?chain=${chain}`;
}

