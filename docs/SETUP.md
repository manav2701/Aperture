# Setup Instructions

## 1. Connect Wallet
Go to http://localhost:3000 and connect your Stacks testnet wallet.

## 2. Create Agents
1. Go to `/agents`
2. Click "Generate 5 Demo Agents" for quick setup
3. OR manually create agents with custom limits

## 3. Add Services
1. Go to `/policies`
2. Select an agent
3. Add approved services (e.g., `https://wttr.in`)

## 4. Test Agents
```bash
curl "http://localhost:3000/api/proxy?target=https://wttr.in/Tokyo?format=j1" \
  -H "x-agent-address: YOUR_AGENT_ADDRESS"