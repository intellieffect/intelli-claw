#!/usr/bin/env bun
/**
 * intelli-claw channel for Claude Code.
 *
 * Bridges the intelli-claw web UI (apps/web, Vite + React 19) to a Claude Code
 * session over a loopback HTTP + WebSocket server, using the MCP channel
 * contract (experimental `claude/channel` capability).
 *
 * Based on the fakechat reference plugin
 * (anthropics/claude-plugins-official/external_plugins/fakechat).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  copyFileSync,
  realpathSync,
} from "fs";
import { homedir } from "os";
import { join, extname, basename, sep } from "path";
import type { ServerWebSocket } from "bun";

const PORT = Number(process.env.INTELLI_CLAW_PORT ?? 8790);
const HOST = process.env.INTELLI_CLAW_HOST ?? "127.0.0.1";
const STATE_DIR = join(homedir(), ".claude", "channels", "intelli-claw");
const INBOX_DIR = join(STATE_DIR, "inbox");
const OUTBOX_DIR = join(STATE_DIR, "outbox");
const DEFAULT_SESSION_ID = "main";

// CORS allowlist — Vite dev, prod preview, Electron packaged shell.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:4000",
  "http://localhost:4100",
  "http://127.0.0.1:4000",
  "http://127.0.0.1:4100",
]);
const ELECTRON_ORIGIN_RE = /^app:\/\//;

export type ChannelMsg = {
  id: string;
  from: "user" | "assistant";
  text: string;
  ts: number;
  sessionId: string;
  replyTo?: string;
  file?: { url: string; name: string };
};

export type Wire =
  | ({ type: "msg" } & ChannelMsg)
  | { type: "edit"; id: string; text: string }
  | { type: "session"; sessionId: string; note?: string };

const clients = new Set<ServerWebSocket<unknown>>();
let seq = 0;
let activeSessionId = DEFAULT_SESSION_ID;

export function nextId(): string {
  return `m${Date.now()}-${++seq}`;
}

function broadcast(m: Wire): void {
  const data = JSON.stringify(m);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

export function mime(ext: string): string {
  return MIME[ext] ?? "application/octet-stream";
}

// Block reply(files=[...]) from leaking state directory contents. Only inbox/
// is exempt — files inbounded from the UI can be echoed back.
export function assertSendable(f: string): void {
  let real: string;
  let stateReal: string;
  try {
    real = realpathSync(f);
    stateReal = realpathSync(STATE_DIR);
  } catch {
    return; // Let downstream stat fail with the proper error.
  }
  const inbox = join(stateReal, "inbox");
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`);
  }
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow =
    origin && (ALLOWED_ORIGINS.has(origin) || ELECTRON_ORIGIN_RE.test(origin))
      ? origin
      : "";
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

// ---- MCP server (stdio) --------------------------------------------------

const mcp = new Server(
  { name: "intelli-claw-channel", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
      experimental: { "claude/channel": {} },
    },
    instructions:
      `The sender reads the intelli-claw UI, not this session. Anything you want them to see must go through the reply tool — your transcript output never reaches the UI.\n\n` +
      `Messages from the UI arrive as <channel source="intelli-claw" session_id="..." message_id="..." user="...">. If the tag has a file_path attribute, Read that file — it is an upload from the UI. Reply with the reply tool. UI is at http://${HOST}:${PORT}.\n\n` +
      `The UI supports multiple named sessions (main, scout, biz-ops, etc). The inbound tag's session_id tells you which conversation the user is in. Use session_switch to acknowledge a session change the user requested, and scope your tone/tools to match.`,
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a message to the intelli-claw UI. Pass reply_to for quote-reply, files for attachments (absolute paths, 50 MB max each).",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          reply_to: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          session_id: {
            type: "string",
            description:
              "Optional: target session. Defaults to the currently active session.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "edit_message",
      description: "Edit a previously sent message.",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string" },
          text: { type: "string" },
        },
        required: ["message_id", "text"],
      },
    },
    {
      name: "session_switch",
      description:
        "Acknowledge a session-id change requested by the UI. Broadcasts the new active session so every connected client updates its header.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          note: { type: "string" },
        },
        required: ["session_id"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (req.params.name) {
      case "reply": {
        const text = String(args.text ?? "");
        const replyTo = args.reply_to as string | undefined;
        const sessionId = (args.session_id as string | undefined) ?? activeSessionId;
        const files = ((args.files as string[] | undefined) ?? []).slice(0, 1);

        let file: { url: string; name: string } | undefined;
        if (files[0]) {
          const f = files[0];
          assertSendable(f);
          const st = statSync(f);
          if (st.size > 50 * 1024 * 1024) throw new Error(`file too large: ${f}`);
          mkdirSync(OUTBOX_DIR, { recursive: true });
          const ext = extname(f).toLowerCase();
          const out = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          copyFileSync(f, join(OUTBOX_DIR, out));
          file = { url: `/files/${out}`, name: basename(f) };
        }
        const id = nextId();
        broadcast({
          type: "msg",
          id,
          from: "assistant",
          text,
          ts: Date.now(),
          sessionId,
          replyTo,
          file,
        });
        return { content: [{ type: "text", text: `sent (${id})` }] };
      }
      case "edit_message": {
        broadcast({
          type: "edit",
          id: String(args.message_id),
          text: String(args.text),
        });
        return { content: [{ type: "text", text: "ok" }] };
      }
      case "session_switch": {
        const sid = String(args.session_id);
        const note = args.note as string | undefined;
        activeSessionId = sid;
        broadcast({ type: "session", sessionId: sid, note });
        return { content: [{ type: "text", text: `session: ${sid}` }] };
      }
      default:
        return {
          content: [{ type: "text", text: `unknown: ${req.params.name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `${req.params.name}: ${err instanceof Error ? err.message : err}`,
        },
      ],
      isError: true,
    };
  }
});

export function buildNotificationPayload(
  id: string,
  sessionId: string,
  text: string,
  file?: { path: string; name: string },
): Parameters<typeof mcp.notification>[0] {
  return {
    method: "notifications/claude/channel",
    params: {
      content: text || `(${file?.name ?? "attachment"})`,
      meta: {
        chat_id: "web",
        session_id: sessionId,
        message_id: id,
        user: "web",
        ts: new Date().toISOString(),
        ...(file ? { file_path: file.path } : {}),
      },
    },
  };
}

export function deliverNotification(
  id: string,
  sessionId: string,
  text: string,
  file?: { path: string; name: string },
): Parameters<typeof mcp.notification>[0] {
  const payload = buildNotificationPayload(id, sessionId, text, file);
  // Best-effort emit — transport is not connected during unit tests.
  mcp.notification(payload).catch(() => {});
  return payload;
}

// ---- HTTP + WS server (loopback) ----------------------------------------

export function readSendPayload(body: unknown): {
  id: string;
  text: string;
  sessionId: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const text = typeof o.text === "string" ? o.text : "";
  const sessionId =
    typeof o.session_id === "string" && o.session_id ? o.session_id : activeSessionId;
  if (!id || !text.trim()) return null;
  return { id, text: text.trim(), sessionId };
}

export interface StartHttpServerOptions {
  port?: number;
  hostname?: string;
}

export async function startHttpServer(
  opts: StartHttpServerOptions = {},
): Promise<ReturnType<typeof Bun.serve>> {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

  return Bun.serve({
    port: opts.port ?? PORT,
    hostname: opts.hostname ?? HOST,
    fetch(req, server) {
      const url = new URL(req.url);
      const origin = req.headers.get("origin");
      const baseHeaders = corsHeaders(origin);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: baseHeaders });
      }

      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400, headers: baseHeaders });
      }

      if (url.pathname === "/" || url.pathname === "/config") {
        const body = JSON.stringify({
          status: "ok",
          plugin: "intelli-claw-channel",
          version: "0.1.0",
          port: PORT,
          activeSessionId,
          tools: ["reply", "edit_message", "session_switch"],
        });
        return new Response(body, {
          headers: { ...baseHeaders, "content-type": "application/json" },
        });
      }

      if (url.pathname.startsWith("/files/")) {
        const f = url.pathname.slice("/files/".length);
        if (f.includes("..") || f.includes("/")) {
          return new Response("bad", { status: 400, headers: baseHeaders });
        }
        try {
          return new Response(readFileSync(join(OUTBOX_DIR, f)), {
            headers: {
              ...baseHeaders,
              "content-type": mime(extname(f).toLowerCase()),
            },
          });
        } catch {
          return new Response("404", { status: 404, headers: baseHeaders });
        }
      }

      if (url.pathname === "/send" && req.method === "POST") {
        return (async () => {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return new Response("bad json", { status: 400, headers: baseHeaders });
          }
          const payload = readSendPayload(body);
          if (!payload) {
            return new Response("missing id or text", {
              status: 400,
              headers: baseHeaders,
            });
          }
          broadcast({
            type: "msg",
            id: payload.id,
            from: "user",
            text: payload.text,
            ts: Date.now(),
            sessionId: payload.sessionId,
          });
          deliverNotification(payload.id, payload.sessionId, payload.text);
          return new Response(null, { status: 204, headers: baseHeaders });
        })();
      }

      if (url.pathname === "/upload" && req.method === "POST") {
        return (async () => {
          const form = await req.formData();
          const id = String(form.get("id") ?? "");
          const text = String(form.get("text") ?? "");
          const sessionId = String(form.get("session_id") ?? activeSessionId);
          const f = form.get("file");
          if (!id) {
            return new Response("missing id", { status: 400, headers: baseHeaders });
          }
          let file: { path: string; name: string } | undefined;
          if (f instanceof File && f.size > 0) {
            mkdirSync(INBOX_DIR, { recursive: true });
            const ext = extname(f.name).toLowerCase() || ".bin";
            const path = join(INBOX_DIR, `${Date.now()}${ext}`);
            writeFileSync(path, Buffer.from(await f.arrayBuffer()));
            file = { path, name: f.name };
          }
          broadcast({
            type: "msg",
            id,
            from: "user",
            text,
            ts: Date.now(),
            sessionId,
            file: file ? { url: `file://${file.path}`, name: file.name } : undefined,
          });
          deliverNotification(id, sessionId, text, file);
          return new Response(null, { status: 204, headers: baseHeaders });
        })();
      }

      return new Response("404", { status: 404, headers: baseHeaders });
    },
    websocket: {
      open: (ws) => {
        clients.add(ws);
      },
      close: (ws) => {
        clients.delete(ws);
      },
      message: (_ws, raw) => {
        try {
          const obj = JSON.parse(String(raw)) as {
            id?: string;
            text?: string;
            session_id?: string;
          };
          if (!obj.id || !obj.text?.trim()) return;
          const sessionId = obj.session_id || activeSessionId;
          deliverNotification(obj.id, sessionId, obj.text.trim());
        } catch {
          // Ignore malformed frames.
        }
      },
    },
  });
}

// Bun entrypoint guard — skip during `bun test`.
const isEntrypoint = import.meta.main;
if (isEntrypoint) {
  await mcp.connect(new StdioServerTransport());
  await startHttpServer();
  process.stderr.write(`intelli-claw-channel: http://${HOST}:${PORT}\n`);
}
