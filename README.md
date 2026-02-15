# Aperture

### The Permission Layer for Autonomous AI Agents on Stacks Blockchain

[![Built with Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Stacks](https://img.shields.io/badge/Stacks-Blockchain-5546FF?style=flat-square&logo=stacks)](https://www.stacks.co/)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)

[**Live Demo**](https://aperture.vercel.app) 

---

## The Problem

Imagine you're managing a company with **50 AI agents** working autonomously across your organization:

- **Agent 1** handles travel bookings for your sales team
- **Agent 2** purchases market research reports daily  
- **Agent 3** fetches real-time weather data for logistics planning
- **Agent 4** sends transactional emails via paid APIs
- **Agent 5-50** each performing specialized tasks, all requiring external API calls

### Without Aperture, your reality looks like this:

```
❌ Unlimited Access
   Every agent has full access to your company wallet
   No distinction between a $5 API call and a $5000 one

❌ Zero Visibility  
   You discover $10,000 was spent only when checking your wallet
   No way to know which agent spent what, where, or why

❌ No Governance
   Agents can call ANY external service
   No approval process for new API integrations
   One misconfigured agent can drain your entire balance

❌ Security Nightmare
   Compromised agent = compromised wallet
   No way to pause a suspicious agent without affecting others
   No audit trail for compliance or debugging
```

### A Real Scenario

**Monday, 9:00 AM** → Agent 12 starts calling a premium data API  
**Monday, 9:15 AM** → Rate limit triggers, agent switches to alternative (more expensive) service  
**Monday, 11:30 AM** → CFO notices $8,000 charge on company card  
**Monday, 2:00 PM** → Engineering team still debugging which agent caused it  
**Tuesday, 9:00 AM** → Happens again because no policy was in place

**The core issue:** AI agents operate in a trust-based system where "having the wallet address" means "unlimited spending power."

---

## The Solution

**Aperture** introduces **policy-based financial governance** for AI agents using blockchain-verified identity and programmable spending controls.

### How It Works: The 50-Agent Company

Instead of giving each agent direct wallet access, Aperture creates a **permission layer**:

```
Company Owner (You)
    ↓
Stacks Wallet (Your Control)
    ↓
Aperture Policy Layer ← All agents must pass through here
    ↓
50 Agent Wallets (Unique blockchain addresses)
```

**What you can now do:**

**Define Spending Limits**
```
Agent 12 (Market Research):
  - Daily limit: $500 STX
  - Per-transaction: $100 STX max
  - Status: Active
```

**Approve Services**
```
Agent 12 can ONLY call:
  ✓ api.marketdata.com
  ✓ research.insights.io
  ✗ Everything else blocked
```

**Real-Time Monitoring**
```
Dashboard shows:
  - Agent 12: $247 spent today (49% of daily limit)
  - Agent 8: Paused (suspicious activity)
  - Agent 23: $0.50 spent (0.1% of limit)
  - Company total: $3,450 / $25,000 daily budget
```

**Emergency Controls**
```
Suspicious activity on Agent 12?
  → One-click pause
  → All its requests blocked immediately
  → Other 49 agents continue working
```

**Complete Audit Trail**
```
Every transaction logged:
  - Which agent made the call
  - What service was accessed  
  - How much was spent
  - Timestamp and result
  - Export to CSV for compliance
```

### The Key Innovation

Aperture uses **blockchain-verified agent identities** (Stacks addresses) combined with **on-chain policy enforcement** to create an **economic security layer** that sits between your agents and external services.

**Think of it as:**
- **IAM (Identity & Access Management)** for AI agents
- **Corporate credit cards** with individualized limits
- **API gateway** with financial controls
- **Audit system** for AI spending

All powered by Clarity smart contracts on Stacks blockchain, making policies **immutable, transparent, and verifiable**.

---

## System Architecture

### Identity & Access Layer
<img width="2752" height="1536" alt="Gemini_Generated_Image_3xe80w3xe80w3xe8" src="https://github.com/user-attachments/assets/84e1d0e0-b610-4e14-a44c-5ba93c6f452f" />

**Diagram shows:**
- Company owner wallet at top with crown icon
- Connection to owner wallet (Stacks)
- Authentication flow through "Wallet Connect / Authentication"
- Three agent wallets below with unique Stacks addresses
- Glowing lines representing secure connection / auth flow
- Real blockchain-verifiable addresses for all agents

**Concept:** Centralized control over distributed agents, where the company owner authenticates through their Stacks wallet and manages multiple agent identities, each with their own unique blockchain address for accountability.

---

### Full Platform Architecture
<img width="2752" height="1536" alt="sysdesign" src="https://github.com/user-attachments/assets/523b120b-af39-4ad7-a69d-6444760db473" />

**Diagram shows complete system with layers:**

**Management & Identity (Left Side):**
- Company owner wallet (Stacks)
- Wallet connect / authentication
- Agent management panel with daily/tx limits
- Pause/Delete controls
- Recovery phrase backup (secure)
- Agent wallets with STX addresses

**Integration Layer (Bottom Left):**
- n8n Workflows
- Python Scripts  
- Mobile/Webhook integration points

**Policy & Enforcement Proxy - The Core (Center):**
- Policy store & rules database
- Real-time policy check engine
- Approved services allowlist
- Proxy enforcement gate with "cannot bypass" security
- Economic-layer enforcement

**External Services Layer (Right Side):**
- Weather API
- httpbin.org
- x402 Payment API

**Blockchain Verification Layer (Bottom Right):**
- Stacks Explorer for address verification

**Data & Observability Layer (Bottom Center):**
- Supabase data store with tables: Policies, Logs, Sessions
- Company dashboard showing usage, status, spending metrics

**Request Flow:**
1. Define policies (owner sets limits)
2. Agent request with x-agent-address header
3. Proxy checks policy → Allowed or Blocked
4. If allowed: Execute & log to database
5. If blocked: Return error & log attempt
6. Dashboard updates in real-time

---

### Request Flow

```
1. Agent makes API request
       ↓
2. Request includes x-agent-address header
       ↓
3. Aperture Proxy intercepts request
       ↓
4. Policy Engine validates:
   - Is agent active?
   - Within daily limit?
   - Within per-tx limit?
   - Service approved?
       ↓
5a. APPROVED → Forward to API → Log transaction
5b. BLOCKED → Return 403 → Log attempt
       ↓
6. Dashboard updates in real-time
```

---

## Key Features

### Policy Management
- **Spending Limits**: Set daily and per-transaction caps (STX & sBTC)
- **Service Allowlist**: Whitelist specific APIs agents can access
- **Facilitator Control**: Restrict which x402 payment facilitators are trusted
- **Multi-Asset Support**: Manage both STX and sBTC spending

### Agent Management
- **Unique Identities**: Each agent gets a Stacks blockchain address
- **Lifecycle Control**: Create, pause, resume, or revoke agent access
- **Batch Operations**: Manage multiple agents simultaneously
- **Recovery Options**: Secure phrase backup for agent wallet recovery

### Real-Time Monitoring
- **Live Dashboard**: See all agent activity as it happens
- **Spending Analytics**: Track daily usage vs. limits
- **Session Tracking**: Monitor active agent sessions with budgets
- **Alert System**: Get notified when limits are approaching

### Audit & Compliance
- **Complete History**: Every transaction logged with full context
- **CSV Export**: Download audit logs for compliance reporting
- **Blocked Attempts**: Track unauthorized access attempts
- **Time-Series Data**: Analyze spending patterns over time

### Emergency Response
- **Instant Pause**: Stop a specific agent immediately
- **Bulk Actions**: Pause all agents in one click
- **Revocation**: Permanently disable compromised agents
- **No Downtime**: Other agents continue working normally

---

## Technology Stack

### Frontend & Backend
- **Framework**: Next.js 16 (App Router) with TypeScript
- **Styling**: Tailwind CSS with custom design system
- **State Management**: React Hooks + Supabase real-time subscriptions
- **Authentication**: Stacks Wallet Connect (Leather, Xverse)

### Blockchain Layer
- **Network**: Stacks Blockchain (Testnet & Mainnet ready)
- **Smart Contracts**: Clarity 4
  - `policy-manager.clar`: Policy enforcement and validation
  - `session-tracker.clar`: Time-bounded session management
- **Payment Protocol**: x402-stacks V2 for HTTP 402 payments

### Data & Infrastructure
- **Database**: Supabase (PostgreSQL)
  - Real-time subscriptions for live updates
  - Row-level security for multi-tenant isolation
  - Atomic transactions for spending increments
- **Hosting**: Vercel (Frontend), Supabase Cloud (Database)
- **Blockchain RPC**: Stacks API nodes

### Integration Layer
- **AI Agent Platforms**: n8n, LangChain, AutoGPT compatible
- **Webhook Support**: REST API for any HTTP client
- **SDKs**: Works with Python, Node.js, or any language

---

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Stacks wallet (Leather or Xverse)
- Supabase account
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/manav2701/Aperture.git
cd Aperture

# Install dependencies
cd webapp
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase and Stacks credentials
```

### Environment Configuration

Create `webapp/.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stacks Network
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_SERVER_ADDRESS=your_stacks_address

# x402 Protocol
NEXT_PUBLIC_FACILITATOR_URL=https://facilitator.stacksx402.com

# Smart Contracts (after deployment)
NEXT_PUBLIC_POLICY_MANAGER_CONTRACT=deployer_address.policy-manager
NEXT_PUBLIC_SESSION_TRACKER_CONTRACT=deployer_address.session-tracker
```

### Database Setup

1. Create a Supabase project
2. Run the SQL schema from `docs/database-schema.sql`
3. Enable real-time for required tables:
   - `payment_history`
   - `daily_spending`
   - `sessions`

### Smart Contract Deployment

```bash
# Install Clarinet
curl -L https://github.com/hirosystems/clarinet/releases/download/v2.9.0/clarinet-linux-x64.tar.gz | tar xz

# Deploy to testnet
cd contracts
clarinet deployments apply --testnet

# Copy deployed contract addresses to webapp/.env.local
```

### Run Development Server

```bash
cd webapp
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect your Stacks wallet.

---

## Usage Guide

### For Company Owners

**1. Connect Your Wallet**
- Click "Connect Wallet" in the dashboard
- Approve connection with Leather/Xverse
- Your Stacks address becomes the policy owner

**2. Create Agent Policies**
```
Navigate to Policies → Create New Policy
  - Set daily limit (e.g., 10 STX)
  - Set per-transaction limit (e.g., 1 STX)
  - Approve services (e.g., api.weather.com)
  - Create agent wallet address
```

**3. Monitor Activity**
- Dashboard shows real-time spending
- View individual agent statistics
- Track daily budget consumption
- Export audit logs as needed

**4. Emergency Response**
```
If Agent 12 behaves suspiciously:
  → Go to Agents page
  → Click "Pause" next to Agent 12
  → All its requests are blocked immediately
  → Review logs to investigate
  → Resume or Revoke as needed
```

### For AI Agent Developers

**Integrate in 3 Steps:**

**Step 1: Get Your Agent Address**
```
Your company admin provides:
  - Agent wallet address (e.g., ST2ABC...XYZ)
  - Approved services list
  - Spending limits
```

**Step 2: Route Requests Through Proxy**
```python
# Python example
import requests

headers = {
    'x-agent-address': 'ST2ABC...XYZ'  # Your agent's Stacks address
}

response = requests.get(
    'https://your-aperture-proxy.com/api/proxy',
    params={'target': 'https://api.weather.com/data'},
    headers=headers
)
```

**Step 3: Handle Responses**
```python
if response.status_code == 200:
    # Request approved and executed
    data = response.json()
elif response.status_code == 403:
    # Blocked: exceeded limit or unapproved service
    print("Payment blocked:", response.json()['error'])
elif response.status_code == 402:
    # Payment required but insufficient balance
    print("Insufficient funds")
```

**Works with any platform:**
- n8n workflows (HTTP Request node)
- LangChain agents (custom tool wrapper)
- Python scripts (requests library)
- Node.js bots (axios/fetch)
- Mobile apps (HTTP client)

---

## Use Cases

### Enterprise AI Operations
**Scenario**: Marketing agency with 30 AI agents generating content, images, and reports

**Implementation**:
- Content agents: $50/day limit, approved APIs: OpenAI, Midjourney
- Research agents: $20/day limit, approved APIs: Google, NewsAPI
- Analytics agents: $10/day limit, approved APIs: internal data warehouse

**Result**: $2,400 monthly budget enforced automatically, complete visibility into AI spending

### Startup Cost Control
**Scenario**: Bootstrapped SaaS with 5 AI agents handling customer support

**Implementation**:
- Support agents: $5/day each, only approved for Zendesk API
- Emergency pause button for off-hours suspicious activity
- Weekly spending reports for investor updates

**Result**: Predictable AI costs, no surprise bills, compliance-ready audit trail

### Research Lab Collaboration
**Scenario**: University research lab with 15 PhD students, each with their own AI agent

**Implementation**:
- Each student gets agent with $100/month budget
- Professor can monitor all spending in one dashboard
- Agents can only access approved academic APIs

**Result**: Fair resource allocation, spending transparency, grant compliance

### Multi-Tenant AI Platform
**Scenario**: B2B SaaS offering AI agents to customers

**Implementation**:
- Each customer gets isolated agent policies
- Platform owner sets global limits per customer tier
- Customers see their own usage dashboard

**Result**: Scalable business model with usage-based pricing

---

## Project Structure

```
aperture/
│
├── contracts/                    # Clarity Smart Contracts
│   ├── contracts/
│   │   ├── policy-manager.clar   # Policy enforcement (400+ lines)
│   │   └── session-tracker.clar  # Session management (200+ lines)
│   ├── tests/                    # Contract unit tests
│   └── deployments/              # Deployment manifests
│
├── webapp/                       # Next.js Application
│   ├── app/
│   │   ├── page.tsx             # Landing page
│   │   ├── dashboard/           # Main dashboard
│   │   ├── policies/            # Policy management UI
│   │   ├── agents/              # Agent creation & control
│   │   ├── sessions/            # Session monitoring
│   │   ├── audit/               # Audit log viewer
│   │   └── api/
│   │       └── proxy/           # Universal payment proxy
│   │
│   ├── components/              # React components
│   │   ├── WalletConnect.tsx   # Stacks wallet integration
│   │   ├── LayoutWrapper.tsx   # Navigation & layout
│   │   └── EmergencyControls.tsx
│   │
│   ├── lib/
│   │   ├── stacks.ts           # Blockchain utilities
│   │   └── supabase.ts         # Database client
│   │
│   └── types/                  # TypeScript definitions
│
└── docs/                        # Documentation
    ├── architecture.md
    ├── api-reference.md
    └── integration-guide.md
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Links

- **Live Demo**: [https://aperture.vercel.app](https://aperture.vercel.app)
- **Smart Contracts**: [Stacks Explorer](https://explorer.stacks.co/)

---

## Built With

**Stacks Blockchain** • **Next.js** • **Supabase** • **TypeScript** • **Tailwind CSS** • **x402 Protocol**

---

<div align="center">

**Built for secure, transparent, and controllable AI agent operations**

[Get Started](https://aperture.vercel.app) • [Documentation](./docs) • [Report Issue](https://github.com/manav2701/Aperture/issues)

</div>
