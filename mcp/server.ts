#!/usr/bin/env bun
/**
 * MCP Code Execution Server for RS-Agent
 *
 * Manages multiple bot connections dynamically at runtime.
 * Agents can connect, disconnect, and execute code on any connected bot.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { botManager } from './api/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create MCP server
const server = new Server(
  {
    name: 'rs-agent-bot',
    version: '2.0.0'
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

// List available API modules as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'file://api/bot.ts',
        name: 'Bot API',
        description: 'High-level bot actions: chopTree, walkTo, attackNpc, openBank, etc. Domain-aware methods that wait for effects.',
        mimeType: 'text/plain'
      },
      {
        uri: 'file://api/sdk.ts',
        name: 'SDK API',
        description: 'Low-level SDK: getState, sendWalk, getInventory, findNearbyNpc, etc. Direct protocol access.',
        mimeType: 'text/plain'
      }
    ]
  };
});

// Read API module contents
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    const uri = request.params.uri;
    let filePath: string;

    if (uri.startsWith('file://')) {
      const relativePath = uri.replace('file://', '');
      filePath = join(__dirname, relativePath);
    } else {
      throw new Error(`Unsupported URI scheme: ${uri}`);
    }

    const content = await Bun.file(filePath).text();

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'text/plain',
          text: content
        }
      ]
    };
  } catch (error: any) {
    throw new Error(`Failed to read resource: ${error.message}`);
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'execute_code',
        description: 'Execute TypeScript code on a bot. Auto-connects using credentials from bots/{name}/bot.env. The code runs in an async context with bot (BotActions) and sdk (BotSDK) available.',
        inputSchema: {
          type: 'object',
          properties: {
            bot_name: {
              type: 'string',
              description: 'Bot name (matches folder in bots/). Auto-connects on first use.'
            },
            code: {
              type: 'string',
              description: 'TypeScript code to execute. Available globals: bot (BotActions), sdk (BotSDK). Example: "await bot.chopTree(); return sdk.getState();"'
            }
          },
          required: ['bot_name', 'code']
        }
      },
      {
        name: 'disconnect_bot',
        description: 'Disconnect a connected bot',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Bot name to disconnect'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'list_bots',
        description: 'List all connected bots',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'disconnect_bot': {
        const botName = args?.name as string;

        if (!botName) {
          return errorResponse('Bot name is required');
        }

        await botManager.disconnect(botName);
        return successResponse({ message: `Disconnected bot "${botName}"` });
      }

      case 'list_bots': {
        const bots = botManager.list();
        return successResponse({
          bots,
          count: bots.length
        });
      }

      case 'execute_code': {
        const botName = args?.bot_name as string;
        const code = args?.code as string;

        if (!botName) {
          return errorResponse('bot_name is required');
        }

        if (!code) {
          return errorResponse('code is required');
        }

        // Auto-connect if not already connected
        let connection = botManager.get(botName);
        if (!connection) {
          console.error(`[MCP] Bot "${botName}" not connected, auto-connecting...`);
          connection = await botManager.connect(botName);
        }

        // Capture console output
        const logs: string[] = [];
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
        console.warn = (...args) => logs.push('[warn] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
        // Don't capture console.error - let it go to stderr for MCP debugging

        try {
          // Create async function with bot and sdk as parameters
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const fn = new AsyncFunction('bot', 'sdk', code);

          // Execute code
          const result = await fn(connection.bot, connection.sdk);

          // Build formatted output
          const parts: string[] = [];

          if (logs.length > 0) {
            parts.push('── Console ──');
            parts.push(logs.join('\n'));
          }

          if (result !== undefined) {
            if (logs.length > 0) parts.push('');
            parts.push('── Result ──');
            parts.push(JSON.stringify(result, null, 2));
          }

          const output = parts.length > 0 ? parts.join('\n') : '(no output)';

          return {
            content: [{ type: 'text', text: output }]
          };
        } finally {
          console.log = originalLog;
          console.warn = originalWarn;
          console.error = originalError;
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const errorMessage = `Error: ${error.message}\n\nStack trace:\n${error.stack}`;
    return {
      content: [{ type: 'text', text: errorMessage }],
      isError: true
    };
  }
});

function successResponse(data: any) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true
  };
}

// Start server
async function main() {
  console.error('[MCP Server] Starting RS-Agent MCP server v2.0...');
  console.error('[MCP Server] No bots connected. Use connect_bot tool to connect.');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP Server] Server running on stdio');
}

main().catch((error) => {
  console.error('[MCP Server] Fatal error:', error);
  process.exit(1);
});
