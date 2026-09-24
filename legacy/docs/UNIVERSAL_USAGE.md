# Using x402 Policy Manager with ANY Agent

## For n8n Users

### Step 1: Import Workflow
1. Download `n8n-workflow.json`
2. In n8n: Import → Select file
3. Workflow appears in your canvas

### Step 2: Configure
Edit the "Config" node:
- `agentAddress`: Your Stacks testnet address
- `policyProxyUrl`: `https://your-deployed-app.vercel.app/api/proxy`
- `targetApi`: Any x402-enabled API you want to call

### Step 3: Create Policy
1. Go to your Policy Manager app
2. Click "Policies"
3. Create policy with limits
4. Add the target API's domain to approved services
5. Add facilitator if needed

### Step 4: Run!
Click "Execute Workflow" in n8n

## For LangChain/Python Users
```python
import requests

PROXY_URL = "https://your-app.vercel.app/api/proxy"
AGENT_ADDRESS = "ST28DE...YOUR_ADDRESS"

def call_api_with_policy(target_url):
    response = requests.get(
        PROXY_URL,
        params={"target": target_url},
        headers={"x-agent-address": AGENT_ADDRESS}
    )
    return response.json()

# Use it
result = call_api_with_policy("https://api.openai.com/v1/completions")
```

## For AutoGPT/Custom Agents

Set environment variable:
```bash
export X402_PROXY=https://your-app.vercel.app/api/proxy
export X402_AGENT_ADDRESS=ST28DE...
```

Then modify your agent's HTTP client to route through proxy.

## How It Works
```
Your Agent → Policy Proxy → Policy Check → Real API
                 ↓
            Dashboard Update
```

1. Agent calls proxy instead of API directly
2. Proxy checks your policy
3. If allowed, forwards to real API
4. Updates dashboard in real-time
5. If blocked, returns 403 with reason