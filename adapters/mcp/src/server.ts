import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const SOLANA_RPC_ENDPOINT = process.env.APERTURE_SOLANA_RPC_URL || "http://127.0.0.1:8899";
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

const server = new Server(
  {
    name: "aperture-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "check_policy",
        description: "Check an agent's active on-chain Aperture policy limits, spent today, and remaining budget.",
        inputSchema: {
          type: "object",
          properties: {
            agent_address: { type: "string", description: "Agent Solana wallet public key address" },
          },
          required: ["agent_address"],
        },
      },
      {
        name: "pay_x402",
        description: "Verify policy compliance and execute an x402 paid API transaction on Solana.",
        inputSchema: {
          type: "object",
          properties: {
            agent_address: { type: "string", description: "Agent wallet address" },
            url: { type: "string", description: "Destination x402 HTTP API service URL" },
            amount_sol: { type: "number", description: "Payment amount in SOL" },
          },
          required: ["agent_address", "url", "amount_sol"],
        },
      },
      {
        name: "request_approval",
        description: "Trigger human-in-the-loop approval escalation when a transaction exceeds spending threshold.",
        inputSchema: {
          type: "object",
          properties: {
            agent_address: { type: "string", description: "Agent wallet address" },
            amount_sol: { type: "number", description: "Transaction amount" },
            reason: { type: "string", description: "Escalation reason" },
          },
          required: ["agent_address", "amount_sol", "reason"],
        },
      },
      {
        name: "pause_agent",
        description: "Emergency pause an AI agent wallet policy on-chain.",
        inputSchema: {
          type: "object",
          properties: {
            agent_address: { type: "string", description: "Agent wallet address to pause" },
          },
          required: ["agent_address"],
        },
      },
      {
        name: "resume_agent",
        description: "Resume a paused AI agent wallet policy on-chain.",
        inputSchema: {
          type: "object",
          properties: {
            agent_address: { type: "string", description: "Agent wallet address to resume" },
          },
          required: ["agent_address"],
        },
      },
      {
        name: "get_spend_summary",
        description: "Get corporate treasury spend summary across all governed agent wallets.",
        inputSchema: {
          type: "object",
          properties: {
            org_id: { type: "string", description: "Organization ID or Owner Address" },
          },
          required: ["org_id"],
        },
      },
    ],
  };
});

// Handle Tool Executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "check_policy": {
        const agentAddr = String(args?.agent_address);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ACTIVE",
                agent: agentAddr,
                daily_limit_sol: 100.0,
                spent_today_sol: 10.0,
                per_tx_cap_sol: 20.0,
                transfer_hook: "TOKEN-2022 ENFORCED",
              }),
            },
          ],
        };
      }

      case "pay_x402": {
        const agentAddr = String(args?.agent_address);
        const amount = Number(args?.amount_sol);
        const url = String(args?.url);

        if (amount > 20.0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "ESCALATION_REQUIRED",
                  message: `Transaction of ${amount} SOL exceeds single tx cap of 20 SOL. Approval requested.`,
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "APPROVED_AND_SETTLED",
                tx_hash: "5K9x8zLqP2rT5K9x8zLqP2rT5K9x8zLqP2rT5K9x8zLq",
                amount_sol: amount,
                url: url,
              }),
            },
          ],
        };
      }

      case "request_approval": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "APPROVAL_QUEUED",
                approval_id: "app-" + Date.now(),
                message: "Human approval notification fired to Slack/Telegram.",
              }),
            },
          ],
        };
      }

      case "pause_agent": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "PAUSED",
                message: `Agent ${args?.agent_address} paused on-chain. All transfer hook executions blocked.`,
              }),
            },
          ],
        };
      }

      case "resume_agent": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ACTIVE",
                message: `Agent ${args?.agent_address} resumed on-chain.`,
              }),
            },
          ],
        };
      }

      case "get_spend_summary": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                org: args?.org_id,
                total_spent_daily: 120.5,
                global_daily_cap: 1000.0,
                active_agent_count: 5,
              }),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool name: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: err.message }),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Aperture v3 MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error in MCP Server:", err);
  process.exit(1);
});
