# 🎬 DEMO CHEAT SHEET

## BEFORE DEMO STARTS

```bash
# Terminal 1: Start dev server
cd webapp
npm run dev

# Terminal 2: Have curl commands ready (see below)
```

---

## DEMO FLOW (2 MINUTES)

### 1. OPENING (15 seconds)
**Say:** "We're building financial infrastructure for autonomous AI. Teams use shared wallets for AI agents but have no spending control."

### 2. CREATE AGENTS (15 seconds)
**Do:**
1. Open http://localhost:3000/agents
2. Click "Generate 5 Demo Agents"
3. Wait for success message

**Say:** "10 seconds to set up 5 agents with different spending limits."

### 3. COPY ADDRESSES (10 seconds)
**Do:**
- Copy FIRST agent address (highest limit)
- Copy LAST agent address (lowest limit)
- Paste into prepared curl commands

### 4. TEST HIGH-LIMIT AGENT (15 seconds)
**Do:**
```bash
curl "http://localhost:3000/api/proxy?target=https://wttr.in/Tokyo?format=j1" \
  -H "x-agent-address: <FIRST_AGENT>"
```

**Say:** "High-limit agent works fine."

### 5. TEST LOW-LIMIT AGENT (30 seconds)
**Do:**
```bash
for i in {1..5}; do
  curl "http://localhost:3000/api/proxy?target=https://httpbin.org/json" \
    -H "x-agent-address: <LAST_AGENT>"
  echo "Request $i"
  sleep 1
done
```

**Say:** "Watch - low-limit agent gets blocked after 2-3 requests."

### 6. SHOW COMPANY DASHBOARD (20 seconds)
**Do:**
- Open http://localhost:3000/company
- Point to status badges
- Point to spending total

**Say:** "Real-time company view. Agent 5 is blocked. Others still working."

### 7. CLOSING (15 seconds)
**Say:** "Key insight: Even if a developer modifies their workflow, they cannot bypass limits. We control the wallet. This is economic-layer enforcement."

---

## PREPARED CURL COMMANDS

### Template (fill in after creating agents):
```bash
# HIGH-LIMIT AGENT (copy address from position 1)
export AGENT_HIGH="<PASTE_HERE>"

curl "http://localhost:3000/api/proxy?target=https://wttr.in/Tokyo?format=j1" \
  -H "x-agent-address: $AGENT_HIGH"

# LOW-LIMIT AGENT (copy address from position 5)
export AGENT_LOW="<PASTE_HERE>"

for i in {1..5}; do
  curl "http://localhost:3000/api/proxy?target=https://httpbin.org/json" \
    -H "x-agent-address: $AGENT_LOW"
  echo "Request $i"
  sleep 1
done
```

---

## KEY TALKING POINTS

### Why This Matters
- ❌ Traditional: Rate limits in workflow (bypassable)
- ✅ x402: Rate limits in wallet (impossible to bypass)

### Who Needs This
- Startups with multiple developers
- Agencies managing client workflows
- Enterprises needing FinOps
- DAOs coordinating agents

### What Makes It Strong
- Works across ALL tools (n8n, scripts, custom)
- Centralized control
- Real-time visibility
- Cryptographically enforced

---

## JUDGE Q&A PREP

### Q: "Why not just use API keys?"
**A:** "Keys can be shared or rotated. Wallet-based identity is cryptographically tied to spending. You cannot bypass what controls your money."

### Q: "What if smart contracts aren't deployed?"
**A:** "We're using Supabase for rapid iteration. The enforcement logic is identical - off-chain is actually faster for demos. Production will be fully on-chain."

### Q: "How is this different from API gateways?"
**A:** "Gateways control access. We control spending. It's the difference between a bouncer and a CFO. We govern the economics."

### Q: "What's the business model?"
**A:** "SaaS pricing per agent/month + transaction fees. Enterprise tier includes multi-sig and custom policies."

---

## BACKUP PLAN

### If live demo fails:
1. Have screenshots ready of:
   - Agents page with 5 agents
   - Company dashboard showing blocked agent
   - Payment history

2. Explain architecture:
```
Company Wallet
  ↓
Policy Layer (x402 Manager)
  ↓
Proxy Enforcement
  ↓
External APIs
```

---

## CONFIDENCE BOOSTERS

✅ **Your system works** - you tested it  
✅ **Your positioning is strong** - economic layer enforcement  
✅ **Your tech is sound** - production-ready patterns  
✅ **Your market is real** - teams need this  

**You got this! 🚀**
