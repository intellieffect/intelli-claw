#!/usr/bin/env bun
/**
 * WebChat channel for Claude Code.
 *
 * MCP channel server that bridges a WebSocket ↔ Claude Code session.
 * Same architecture as the Telegram channel plugin:
 *   - Declares `claude/channel` capability
 *   - WebSocket messages → `notifications/claude/channel` → Claude Code
 *   - Claude Code calls `reply` tool → WebSocket → browser
 *
 * Start: claude --channels /path/to/plugins/webchat --dangerously-skip-permissions
 * Or:    claude --plugin-dir /path/to/plugins/webchat --channels webchat
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { WebSocketServer, WebSocket } from 'ws'

const WS_PORT = parseInt(process.env.WEBCHAT_PORT ?? '4003', 10)

// Track connected web clients
const clients = new Set<WebSocket>()
let messageIdCounter = 0

// ── MCP Server ──────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'webchat', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
      },
    },
    instructions: [
      'Messages from the web chat arrive as <channel source="webchat" message_id="..." ts="...">.',
      'Reply with the reply tool. The reply content will be displayed in the web chat UI.',
      'You can use markdown in replies.',
      'reply accepts an optional message_id to quote-reply a specific message.',
    ].join('\n'),
  },
)

// ── Tools ───────────────────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a reply to the web chat. Content supports markdown.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string',
            description: 'The message content (markdown supported)',
          },
          message_id: {
            type: 'string',
            description: 'Optional: message ID to reply to',
          },
        },
        required: ['content'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'reply') {
    const content = (args as { content: string; message_id?: string }).content
    const replyTo = (args as { message_id?: string }).message_id

    const payload = JSON.stringify({
      type: 'assistant',
      content,
      replyTo,
      timestamp: new Date().toISOString(),
      id: `cc-${Date.now()}`,
    })

    let sent = 0
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
        sent++
      }
    }

    return {
      content: [{ type: 'text', text: sent > 0 ? `Sent to ${sent} client(s)` : 'No clients connected' }],
    }
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] }
})

// ── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT })

wss.on('listening', () => {
  process.stderr.write(`webchat channel: WebSocket listening on ws://127.0.0.1:${WS_PORT}\n`)
})

wss.on('connection', (ws) => {
  clients.add(ws)
  process.stderr.write(`webchat channel: client connected (${clients.size} total)\n`)

  // Send ready status
  ws.send(JSON.stringify({ type: 'bridge:status', status: 'ready' }))

  ws.on('message', (raw) => {
    let msg: { type: string; message?: string }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'send' && msg.message?.trim()) {
      const msgId = String(++messageIdCounter)
      const ts = new Date().toISOString()

      // Forward to Claude Code via MCP channel notification
      mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: msg.message,
          meta: {
            message_id: msgId,
            ts,
            source: 'webchat',
          },
        },
      }).catch((err: Error) => {
        process.stderr.write(`webchat channel: failed to deliver to Claude: ${err}\n`)
      })

      // Echo back acknowledgement
      ws.send(JSON.stringify({
        type: 'user_ack',
        id: msgId,
        timestamp: ts,
      }))
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    process.stderr.write(`webchat channel: client disconnected (${clients.size} total)\n`)
  })
})

// ── Start MCP transport ─────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await mcp.connect(transport)
process.stderr.write('webchat channel: MCP server connected\n')
