# 🏢 Team-Based AI Spending Control Demo

## 🔥 NEW POSITIONING

**From:** Individual AI agent tool  
**To:** Infrastructure layer for team/organizational AI spending control

## 💡 The Killer Insight

> **"We move rate limiting and access control from the application layer to the economic layer."**

### Why This Matters

❌ **Traditional approach:** Rate limits inside n8n/workflows  
- Developers can bypass
- No centralized control
- Easy to modify

✅ **Your approach:** Policy enforcement at wallet/proxy layer  
- Impossible to bypass (controls money)
- Centralized company control
- Works across ALL tools (n8n, scripts, custom agents)

---

## 🎯 Use Case: Startup With 5 Developers

**Scenario:**
- Company wallet: `ST28DERT007J1P63JPP4XGDKW0BWEXFHCJ0RVNT38`
- 5 developers, each with AI agents
- Shared budget, individual limits
- CFO wants visibility & control

**Without your system:**
- ❌ Anyone can spam expensive APIs
- ❌ No spending visibility
- ❌ Costs explode → company goes broke

**With your system:**
- ✅ Each agent has strict limits
- ✅ Real-time spending dashboard
- ✅ Instant pause/revoke capabilities  
- ✅ Audit trail for compliance

---

## 🚀 Quick Start: Multi-Agent Demo

### Step 1: Create Agents via UI (10 seconds)

1. Open http://localhost:3000/agents
2. Click **"Generate 5 Demo Agents"**

This creates:
- **Agent 1** (Senior Dev): 10 STX/day limit
- **Agent 2** (Mid Dev): 5 STX/day limit  
- **Agent 3** (Junior Dev): 2 STX/day limit
- **Agent 4** (Contractor): 1 STX/day limit
- **Agent 5** (Intern): 0.5 STX/day limit

Each agent is automatically approved for:
- ✅ `https://wttr.in`
- ✅ `https://httpbin.org`
- ✅ `https://jsonplaceholder.typicode.com`

### Step 2: Copy Agent Addresses

From the agents table, copy the addresses of:
- **High-limit agent** (Agent 1 - 10 STX/day)
- **Low-limit agent** (Agent 5 - 0.5 STX/day)

### Step 3: Test Different Agents

Replace `AGENT_1_ADDRESS` and `AGENT_5_ADDRESS` with actual addresses:

```bash
# Agent 1 (High limit - should work fine)
curl "http://localhost:3000/api/proxy?target=https://wttr.in/Tokyo?format=j1" \
  -H "x-agent-address: AGENT_1_ADDRESS"

# Agent 5 (Low limit - hit it 5 times to exceed)
for i in {1..5}; do
  curl "http://localhost:3000/api/proxy?target=https://httpbin.org/json" \
    -H "x-agent-address: AGENT_5_ADDRESS"
  echo "Request $i"
  sleep 1
done
```

### Step 4: Watch the Dashboard

Refresh `/company` to see:
- ✅ Agent 1: Still green (within limits)
- ❌ Agent 5: Red/orange (exceeded limit)
- 🔥 Real-time company spending updates

---

## 🎬 Demo Script for Presentation

### Opening (30 seconds)

> **"Imagine a startup where 5 developers use AI agents powered by a shared company wallet. Without controls, anyone could accidentally drain the entire budget overnight."**

### Problem Statement (30 seconds)

> **"Traditional rate limiting happens inside the workflow — developers can modify it, bypass it, or forget to set it. There's no centralized control."**

### Your Solution (45 seconds)

> **"We enforce spending limits at the economic layer. Policy is tied to the wallet, not the workflow. Even if a developer modifies their AI agent, they cannot bypass the limit — because we control whether the payment happens."**

**[Show Company Dashboard]**

> **"Here's our company dashboard. Five agents, different limits. Watch what happens when one exceeds their budget..."**

**[Trigger Agent D to exceed limit]**

> **"Agent D is blocked instantly. But Agent A continues working — independent control, centralized visibility."**

### Key Benefits (30 seconds)

1. **Centralized Control** - Set limits once, enforce everywhere
2. **Full Visibility** - Real-time tracking across all agents
3. **Instant Action** - Pause any agent immediately
4. **Works Everywhere** - n8n, custom scripts, any AI tool

### Closing Line (15 seconds)

> **"We're not just managing AI agents. We're providing financial infrastructure for autonomous AI systems."**

---

## 🏗️ Architecture (For Technical Judges)

```
Company Wallet (Treasury)
        ↓
Policy Layer (Your System)
   ├── Agent A (10 STX/day)
   ├── Agent B (5 STX/day)
   ├── Agent C (2 STX/day)
   └── Agent D (1 STX/day)
        ↓
Proxy Enforcement
        ↓
External APIs
```

**Key Technical Points:**
- 🔐 Identity = Stacks wallet address  
- 📊 State = Supabase (can be moved to smart contracts)
- 🛡️ Enforcement = Proxy layer (cannot be bypassed)
- ⚡ Real-time = Supabase subscriptions

---

## 📊 Metrics to Highlight

1. **Company-wide spending:** Track total across all agents
2. **Per-agent utilization:** See who's approaching limits
3. **Request count:** Monitor API usage patterns
4. **Instant enforcement:** Pause/revoke in real-time
5. **Audit trail:** Complete payment history

---

## 🎯 Target Customers

- 🏢 **Startups** with multiple developers using AI tools
- 🏗️ **Agencies** managing client AI workflows
- 🏦 **Enterprises** needing FinOps for AI spending
- 🤖 **DAOs** coordinating autonomous agents

---

## 🔮 Future Features (Mention if Asked)

- Smart contract-based policies (immutable rules)
- Multi-signature approvals for high-value transactions
- Slack/Discord alerts for limit breaches
- Budget forecasting based on usage patterns
- Integration with Stacks DeFi for automated treasury management

---

## 🚀 Next Steps

1. ✅ Run multi-agent setup SQL
2. ✅ Open company dashboard
3. ✅ Test different agent limits
4. ✅ Practice your demo script
5. ✅ Record a video walkthrough

---

## 💬 Answering Judge Questions

**Q: "Why not just use API keys with rate limits?"**  
A: Keys can be shared, rotated, or bypassed. Wallet-based identity + economic enforcement is cryptographically secure and impossible to bypass.

**Q: "What if the smart contracts aren't deployed?"**  
A: We're using Supabase for rapid iteration, but the architecture supports full on-chain deployment. The enforcement logic is identical — off-chain is actually faster for demos.

**Q: "How does this compare to existing solutions?"**  
A: Traditional API gateways control access. We control spending. It's the difference between a bouncer and a CFO — we govern the economics, not just the door.

**Q: "What's the business model?"**  
A: SaaS pricing per agent/month + transaction fees for facilitated payments. Enterprise tier includes custom policies and multi-sig controls.

---

**You're not building an AI tool. You're building financial infrastructure for autonomous systems.** 🔥

That's the pitch that wins hackathons.
