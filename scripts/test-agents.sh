#!/bin/bash

echo "🧪 Testing Multiple Agents..."
echo ""

# Colors (for Unix/Linux/Mac - won't work on Windows cmd but will on Git Bash)
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get agents from your agents page
# You'll need to manually copy these addresses after creating agents
AGENT_HIGH="ST1..." # Replace with high-limit agent
AGENT_LOW="ST3..."  # Replace with low-limit agent

if [ "$AGENT_HIGH" = "ST1..." ]; then
  echo -e "${RED}❌ Please edit this script and add your actual agent addresses${NC}"
  echo "   1. Go to http://localhost:3000/agents"
  echo "   2. Copy agent addresses"
  echo "   3. Update AGENT_HIGH and AGENT_LOW in this script"
  exit 1
fi

echo -e "${YELLOW}Testing High-Limit Agent...${NC}"
curl -s "http://localhost:3000/api/proxy?target=https://wttr.in/Tokyo?format=j1" \
  -H "x-agent-address: $AGENT_HIGH" | jq . 2>/dev/null || echo "Response received (install jq for formatted output)"

echo ""
echo -e "${YELLOW}Testing Low-Limit Agent (5 times to exceed limit)...${NC}"
for i in {1..5}; do
  echo "Request $i..."
  RESPONSE=$(curl -s "http://localhost:3000/api/proxy?target=https://httpbin.org/json" \
    -H "x-agent-address: $AGENT_LOW")
  
  if echo "$RESPONSE" | grep -q "error"; then
    echo -e "${RED}❌ Request $i blocked!${NC}"
    echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
    break
  else
    echo -e "${GREEN}✅ Request $i success${NC}"
  fi
  
  sleep 1
done

echo ""
echo -e "${GREEN}✅ Test complete! Check dashboard: http://localhost:3000/company${NC}"
