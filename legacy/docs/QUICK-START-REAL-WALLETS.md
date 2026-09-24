# ⚡ QUICK START - Real Stacks Wallets (1 PAGE)

## 🎯 What You Built
Real Stacks blockchain wallets for AI agents. Viewable on explorer. Production-ready.

---

## 🚀 SETUP (5 MINUTES)

### 1. Update Database
```bash
# Open Supabase SQL Editor → Run this:
ALTER TABLE policies ADD COLUMN IF NOT EXISTS agent_mnemonic TEXT;
```

### 2. Start Server
```bash
cd webapp
npm run dev
```

### 3. Create Agents
```
1. Go to: http://localhost:3000/agents
2. Click: "🔥 Generate 5 Real Agents"
3. Wait: ~10 seconds
4. Done: 5 real wallets created
```

### 4. Test Agent
```bash
# Copy agent address from table, then:
curl "http://localhost:3000/api/proxy?target=https://wttr.in/Tokyo?format=j1" \
  -H "x-agent-address: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
```

### 5. View on Blockchain
```
Click purple 🔍 icon → Opens Stacks Explorer
https://explorer.hiro.so/address/ST1PQHQ.../testnet
```

---

## 🎬 DEMO (2 MINUTES)

### Show Agent Creation
1. **Click:** "Create Agent"
2. **Modal shows:**
   - ✅ Real address (41 chars)
   - ✅ 24-word mnemonic  
   - ✅ Copy buttons
   - ✅ Explorer link
3. **Click:** 🔍 Explorer icon
4. **Opens:** Blockchain explorer
5. **Say:** "Real blockchain address, viewable publicly"

### Test Agent
```bash
curl "http://localhost:3000/api/proxy?target=https://wttr.in/Tokyo" \
  -H "x-agent-address: <YOUR_AGENT>"
```

### Show Dashboard
```
http://localhost:3000/company
→ Real-time tracking
→ Per-agent spending
→ Company-wide view
```

---

## 💬 KEY TALKING POINTS

### "Are these real addresses?"
> "Yes. Each has a BIP39 mnemonic, private key, and is viewable on Stacks Explorer."

### "Why blockchain?"
> "Cryptographic enforcement. Traditional rate limiting is in code—bypassable. We control the wallet itself—unbypas

sable."

### "How does n8n work?"
> "n8n passes agent address as header. Proxy validates and enforces limits. Works with any tool."

---

## 🔍 BLOCKCHAIN EXPLORER

### View Agent:
```
https://explorer.hiro.so/address/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM?chain=testnet
```

### Fund Agent (Optional):
```
1. Go to: https://explorer.hiro.so/sandbox/faucet?chain=testnet
2. Enter agent address
3. Request 500 testnet STX
4. Refresh explorer → shows funded balance
```

---

## 🤖 N8N INTEGRATION

### Sample Workflow:
```json
{
  "nodes": [
    {
      "name": "Set Config",
      "type": "n8n-nodes-base.set",
      "parameters": {
        "values": {
          "string": [
            {
              "name": "agentAddress",
              "value": "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
            }
          ]
        }
      }
    },
    {
      "name": "HTTP Request",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://your-ngrok.app/api/proxy?target=https://wttr.in/Tokyo",
        "options": {
          "headers": {
            "x-agent-address": "={{$node.Set Config.json.agentAddress}}"
          }
        }
      }
    }
  ]
}
```

---

## 📋 CHECKLIST

- [ ] Database updated (mnemonic column)
- [ ] Agents generated (5 real wallets)
- [ ] Addresses are 41 chars (ST...)
- [ ] Can view on explorer
- [ ] Agents work with curl
- [ ] Dashboard shows activity
- [ ] Demo practiced

---

## 📚 FULL DOCS

1. **[REAL-WALLETS-SUMMARY.md](REAL-WALLETS-SUMMARY.md)** - Complete guide
2. **[N8N-INTEGRATION-GUIDE.md](N8N-INTEGRATION-GUIDE.md)** - n8n workflows
3. **[ARCHITECTURE-DIAGRAM.md](ARCHITECTURE-DIAGRAM.md)** - Visual flow

---

## ✅ WHAT CHANGED

| Before | After |
|--------|-------|
| `ST1ABC123` (fake) | `ST1PQHQKV...GZGM` (real 41 chars) |
| Not on blockchain | ✅ Viewable on explorer |
| Can't receive STX | ✅ Can receive/send STX |
| No recovery | ✅ 24-word mnemonic |
| Demo hack | ✅ Production-ready |

---

## 🎯 YOU'RE READY!

**Test once → Practice demo → Present!** 🚀

Questions? Check full docs above!
