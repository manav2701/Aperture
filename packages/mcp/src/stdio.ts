#!/usr/bin/env node
import { Aperture } from '@aperture/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApertureMcpServer } from './index';

/*
 * `aperture-mcp`: the stdio server for MCP hosts (Claude Desktop, Claude Code, Cursor, …).
 * Configure with APERTURE_API_KEY (the agent's key) and APERTURE_BASE_URL (the gateway URL).
 * Logs go to stderr; stdout carries only the protocol.
 */
const server = createApertureMcpServer(new Aperture());
await server.connect(new StdioServerTransport());
process.stderr.write('aperture-mcp: ready\n');
