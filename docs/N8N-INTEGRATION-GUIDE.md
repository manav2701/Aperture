# 🤖 n8n AI Agent Integration with Real Stacks Addresses

## 🎯 Quick Setup (5 Minutes)

### Step 1: Generate Real Agent Wallet

1. Go to `http://localhost:3000/agents`
2. Click **"Create Agent"**
3. Set spending limits (e.g., 10 STX/day)
4. Click **"Create Agent"**

**Result:** Modal shows:
```
Agent Address: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
Recovery Phrase: whisper worth raven... (24 words)
```

### Step 2: Copy Agent Address

Click **"Copy"** button next to the agent address.

✅ **You now have:** Real Stacks blockchain address!

---

## 📱 Step 3: Setup n8n Workflow

### Sample Workflow JSON:

```json
{
  "name": "AI Agent with x402 Policy",
  "nodes": [
    {
      "parameters": {},
      "id": "start",
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger",
      "position": [250, 300]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "name": "agentAddress",
              "value": "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
              "type": "string"
            },
            {
              "name": "proxyUrl",
              "value": "https://your-ngrok-url.ngrok.app/api/proxy",
              "type": "string"
            }
          ]
        }
      },
      "id": "config",
      "name": "Set Agent Config",
      "type": "n8n-nodes-base.set",
      "position": [450, 300]
    },
    {
      "parameters": {
        "url": "={{ $json.proxyUrl }}?target=https://wttr.in/London?format=j1",
        "authentication": "none",
        "method": "GET",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-agent-address",
              "value": "={{ $json.agentAddress }}"
            }
          ]
        }
      },
      "id": "http",
      "name": "HTTP Request via Proxy",
      "type": "n8n-nodes-base.httpRequest",
      "position": [650, 300]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "name": "weatherData",
              "value": "={{ $json }}",
              "type": "object"
            }
          ]
        }
      },
      "id": "response",
      "name": "Process Response",
      "type": "n8n-nodes-base.set",
      "position": [850, 300]
    }
  ],
  "connections": {
    "Manual Trigger": {
      "main": [[{"node": "Set Agent Config", "type": "main", "index": 0}]]
    },
    "Set Agent Config": {
      "main": [[{"node": "HTTP Request via Proxy", "type": "main", "index": 0}]]
    },
    "HTTP Request via Proxy": {
      "main": [[{"node": "Process Response", "type": "main", "index": 0}]]
    }
  }
}
```

---

## 🔧 Configuration Details

### Node 1: Manual Trigger
Just triggers the workflow manually.

### Node 2: Set Agent Config
```json
{
  "agentAddress": "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  "proxyUrl": "https://your-ngrok-url.ngrok.app/api/proxy"
}
```

**Important:**
- Replace `agentAddress` with YOUR agent's real address
- Replace `proxyUrl` with your ngrok URL

### Node 3: HTTP Request
```
Method: GET
URL: {{ $json.proxyUrl }}?target=https://wttr.in/London?format=j1

Headers:
  x-agent-address: {{ $json.agentAddress }}
```

**This structure allows:**
- ✅ Dynamic agent switching (change agentAddress variable)
- ✅ Easy testing (swap proxy URL for local/production)
- ✅ Reusable across workflows

---

## 🚀 Step 4: Expose Local Server with ngrok

### Start Your Proxy:
```bash
cd webapp
npm run dev
# Server running on http://localhost:3000
```

### Start ngrok:
```bash
ngrok http 3000
```

**Copy the URL:**
```
https://abc123-your-domain.ngrok-free.app
```

### Update n8n Config Node:
```json
{
  "proxyUrl": "https://abc123-your-domain.ngrok-free.app/api/proxy"
}
```

---

## 🧪 Step 5: Test the Workflow

### Execute in n8n:

1. Open your workflow
2. Click **"Execute Workflow"**
3. Watch the nodes execute

### Expected Result:

**Node 2 Output:**
```json
{
  "agentAddress": "ST1PQHQKV...",
  "proxyUrl": "https://abc123.ngrok.app/api/proxy"
}
```

**Node 3 Output:**
```json
{
  "current_condition": [
    {
      "temp_C": "15",
      "weatherDesc": [{"value": "Partly cloudy"}]
    }
  ]
}
```

✅ **Success!** Weather data returned

---

## 📊 Step 6: Verify in Dashboard

### Open Dashboard:
```
http://localhost:3000/company
```

### What You'll See:

```
Agent: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
Status: ✅ Active
Spent Today: 0.001 STX
Transactions: 1
Last Activity: Just now
```

✅ **Your n8n agent is tracked in real-time!**

---

## 🎯 Multiple Agents in n8n

### Scenario: Different Agents for Different Tasks

```json
{
  "nodes": [
    {
      "name": "Route by Task",
      "type": "n8n-nodes-base.switch",
      "parameters": {
        "rules": {
          "rules": [
            {
              "conditions": {
                "taskType": "weather"
              },
              "output": 0
            },
            {
              "conditions": {
                "taskType": "translate"
              },
              "output": 1
            }
          ]
        }
      }
    },
    {
      "name": "Weather Agent",
      "type": "n8n-nodes-base.set",
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "name": "agentAddress",
              "value": "ST1PQHQ...",  // Weather agent (10 STX/day)
              "type": "string"
            }
          ]
        }
      }
    },
    {
      "name": "Translation Agent",
      "type": "n8n-nodes-base.set",
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "name": "agentAddress",
              "value": "ST2CY5V...",  // Translation agent (5 STX/day)
              "type": "string"
            }
          ]
        }
      }
    }
  ]
}
```

**Benefits:**
- Different spending limits per task type
- Separate tracking per agent
- Independent pause/unpause controls

---

## 🔥 Advanced: Real-Time Agent Creation

### Create Agent Programmatically:

```javascript
// In n8n Function node
const axios = require('axios');

// Generate wallet via your API (you'd need to create this endpoint)
const response = await axios.post('http://localhost:3000/api/agents/create', {
  owner_address: 'ST28DERT...',
  daily_limit_stx: 10000000,
  per_tx_limit_stx: 1000000
});

return {
  agentAddress: response.data.agent_address,
  mnemonic: response.data.mnemonic
};
```

---

## 🐛 Troubleshooting

### Error: "No policy found"
**Solution:**
```
1. Verify agent address is copied correctly (41 chars)
2. Check if agent exists in /agents page
3. Ensure wallet is connected
```

### Error: "Service not approved"
**Solution:**
```
1. Go to http://localhost:3000/policies
2. Select your agent
3. Add the service URL (e.g., https://wttr.in)
```

**Or:** Services are auto-approved on creation:
- https://wttr.in
- https://httpbin.org
- https://jsonplaceholder.typicode.com

### Error: "Agent is paused"
**Solution:**
```
1. Go to http://localhost:3000/agents
2. Find your agent
3. Click "Unpause"
```

### Error: "Daily limit exceeded"
**Solution:**
```
1. Wait until tomorrow (daily reset)
2. Or increase limit in /agents page
3. Or create a new agent with higher limit
```

---

## 📱 Mobile Integration Example

### n8n Webhook + Agent:

```json
{
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "path": "ai-agent-request",
        "method": "POST"
      }
    },
    {
      "name": "Extract Agent ID",
      "type": "n8n-nodes-base.set",
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "name": "agentAddress",
              "value": "={{ $json.body.agentId }}",
              "type": "string"
            }
          ]
        }
      }
    },
    {
      "name": "HTTP Request via Proxy",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "https://your-proxy.com/api/proxy?target={{ $json.body.targetUrl }}",
        "method": "GET",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-agent-address",
              "value": "={{ $json.agentAddress }}"
            }
          ]
        }
      }
    }
  ]
}
```

**Usage from mobile app:**
```bash
curl -X POST https://your-n8n-instance.com/webhook/ai-agent-request \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    "targetUrl": "https://wttr.in/Tokyo?format=j1"
  }'
```

---

## ✅ Production Checklist

Before deploying:

- [ ] Use production ngrok URL (or deploy proxy to Vercel)
- [ ] Store agent mnemonics securely (not in n8n workflow)
- [ ] Fund agent wallets with sufficient STX
- [ ] Set appropriate spending limits
- [ ] Enable error notifications
- [ ] Add retry logic for failed requests
- [ ] Log all transactions for audit

---

## 🎬 Demo Script for n8n Integration

### Show n8n Workflow:
1. **Open n8n** - "This is our AI agent workflow"
2. **Show config node** - "Real Stacks address as identity"
3. **Execute workflow** - "Agent makes API call through proxy"
4. **Show dashboard** - "Activity logged in real-time"
5. **Key point:** "Same workflow works across all agents - just change the address"

---

## 🚀 Next Steps

### Expand Your Integration:

1. **Multiple APIs:**
   - OpenAI (text generation)
   - Anthropic (Claude)
   - Stability AI (images)
   - Pinecone (vector DB)

2. **Conditional Logic:**
   - If weather = rain → use high-limit agent
   - If translation → use low-limit agent
   - If error → switch to backup agent

3. **Real Payments:**
   - Fund agent wallets with STX
   - Enable real x402 micropayments
   - Track costs per workflow run

---

**Your n8n workflows now have blockchain-enforced spending limits! 🔥**

Questions? Test with your favorite APIs and watch the dashboard update in real-time!
