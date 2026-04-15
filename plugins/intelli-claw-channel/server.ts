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
import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  copyFileSync,
  realpathSync,
  readdirSync,
} from "fs";
import { homedir } from "os";
import { join, extname, basename, sep } from "path";
import type { ServerWebSocket } from "bun";

/**
 * Claim the port by writing our PID. If a stale instance is holding it (e.g.
 * a previous Claude Code session was killed before shutdown), signal it
 * politely so the new spawn can bind. Mirrors the telegram plugin pattern.
 */
function claimPidLock(stateDir: string, port: number): void {
  // One lock per port so multiple plugin instances on different ports
  // (multi-session iClaw) don't fight for the same file.
  const pidFile = join(stateDir, `bot-${port}.pid`);
  try {
    const existing = parseInt(readFileSync(pidFile, "utf8"), 10);
    if (existing > 1 && existing !== process.pid) {
      process.kill(existing, 0); // throws if no such process
      process.stderr.write(
        `intelli-claw-channel: replacing stale listener pid=${existing}\n`,
      );
      process.kill(existing, "SIGTERM");
    }
  } catch {
    // No pid file, or the recorded process is gone. Either way we're good.
  }
  try {
    writeFileSync(pidFile, String(process.pid));
  } catch {
    // /tmp full or unwritable — not fatal, we just lose the reclaim path.
  }
}

const PORT = Number(process.env.INTELLI_CLAW_PORT ?? 8790);
const HOST = process.env.INTELLI_CLAW_HOST ?? "127.0.0.1";
const STATE_DIR = join(homedir(), ".claude", "channels", "intelli-claw");
const INBOX_DIR = join(STATE_DIR, "inbox");
const OUTBOX_DIR = join(STATE_DIR, "outbox");
const DEFAULT_SESSION_ID = "main";

// LAN mode: set INTELLI_CLAW_TOKEN in the plugin's process env (e.g. via
// ~/.claude/channels/intelli-claw/.env) and set INTELLI_CLAW_HOST=0.0.0.0 (or
// the Tailscale IP) to expose the server beyond loopback. Every non-/config
// request then requires `Authorization: Bearer <token>` (or `?token=…` on
// WebSocket upgrade, since browsers can't set WS headers).
export const CHANNEL_TOKEN = process.env.INTELLI_CLAW_TOKEN ?? "";
export const IS_LAN_MODE = HOST !== "127.0.0.1" && HOST !== "localhost";

// Claude Code stores session transcripts at
//   ~/.claude/projects/<escaped-cwd>/<session-uuid>.jsonl
// where <escaped-cwd> replaces every "/" in the absolute cwd with "-".
// The plugin's cwd matches the Claude Code session's cwd (spawned via stdio
// from that session), so we reuse it to locate the transcript directory.
export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
export function claudeProjectDir(cwd: string = process.cwd()): string {
  return join(CLAUDE_PROJECTS_DIR, cwd.replace(/\//g, "-"));
}

export interface SessionSummary {
  uuid: string;
  /** Preview of the first external user message (best-effort, 200 chars max). */
  title: string;
  /** Total number of entries in the transcript (rough activity signal). */
  messageCount: number;
  /** Last-modified epoch ms. */
  updatedAt: number;
  /** Git branch at startup, if the transcript recorded one. */
  gitBranch?: string;
  /** Absolute jsonl path (useful for debugging). */
  path: string;
}

/**
 * Extract a human-readable preview from the first external user message in a
 * transcript. Tolerant to the variety of shapes Claude Code emits (string
 * content vs. `[{type:"text", text:"…"}]` arrays, hook attachments first,
 * etc.). Returns `""` if nothing usable is found in the first ~200 lines.
 */
function firstUserPreview(jsonlPath: string): { title: string; count: number } {
  let count = 0;
  let title = "";
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return { title: "", count: 0 };
  }
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    count++;
    if (title) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type !== "user") continue;
      if (entry.userType && entry.userType !== "external") continue;
      const message = entry.message as Record<string, unknown> | undefined;
      const content = message?.content;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === "object" && typeof (part as { text?: string }).text === "string") {
            text = (part as { text: string }).text;
            break;
          }
        }
      }
      text = text.trim();
      if (!text) continue;
      // Drop hook injection markers and trim to a preview window.
      const cleaned = text.replace(/^<[^>]+>\s*/m, "").trim();
      title = cleaned.slice(0, 200);
    } catch {
      // Malformed line — skip.
    }
  }
  return { title, count };
}

export function listSessionSummaries(
  cwd: string = process.cwd(),
): SessionSummary[] {
  const dir = claudeProjectDir(cwd);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const summaries: SessionSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const uuid = name.slice(0, -".jsonl".length);
    const path = join(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    const { title, count } = firstUserPreview(path);
    summaries.push({
      uuid,
      title,
      messageCount: count,
      updatedAt: stat.mtimeMs,
      path,
    });
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

// CORS allowlist — Vite dev (http + https when local certs are present),
// prod preview, Electron packaged shell, and mobile webview / Expo dev
// schemes for LAN mode.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:4000",
  "https://localhost:4000",
  "http://localhost:4100",
  "https://localhost:4100",
  "http://127.0.0.1:4000",
  "https://127.0.0.1:4000",
  "http://127.0.0.1:4100",
  "https://127.0.0.1:4100",
]);
// app://  — Electron packaged prod
// capacitor://, ionic://, file://  — mobile native webviews
// exp://  — Expo dev client
const WILDCARD_ORIGIN_RE = /^(?:app|capacitor|ionic|exp|file):\/\//;

export type ChannelMsg = {
  id: string;
  from: "user" | "assistant";
  text: string;
  ts: number;
  sessionId: string;
  replyTo?: string;
  file?: { url: string; name: string };
};

export type PermissionRequest = {
  request_id: string;
  tool_name: string;
  description: string;
  input_preview: string;
};

export type Wire =
  | ({ type: "msg" } & ChannelMsg)
  | { type: "edit"; id: string; text: string }
  | { type: "session"; sessionId: string; note?: string }
  | ({ type: "permission_request" } & PermissionRequest)
  | { type: "permission_verdict"; request_id: string; behavior: "allow" | "deny" };

// Matches fakechat-style 5-char permission codes from the telegram reference
// (lowercase a-z minus 'l', case-insensitive). Format: "yes <id>" or "no <id>".
export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

const clients = new Set<ServerWebSocket<unknown>>();
let seq = 0;
let activeSessionId = DEFAULT_SESSION_ID;

// Permission requests awaiting a user verdict. Keyed by request_id (5 chars).
export const pendingPermissions = new Map<string, PermissionRequest>();

export function parsePermissionReply(
  text: string,
): { request_id: string; behavior: "allow" | "deny" } | null {
  const m = PERMISSION_REPLY_RE.exec(text);
  if (!m) return null;
  const behavior = m[1]!.toLowerCase().startsWith("y") ? "allow" : "deny";
  return { request_id: m[2]!.toLowerCase(), behavior };
}

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
    origin && (ALLOWED_ORIGINS.has(origin) || WILDCARD_ORIGIN_RE.test(origin))
      ? origin
      : "";
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

/**
 * Authorize a request against the configured bearer token.
 *
 * - Loopback with no token configured: all requests pass. This is the dev
 *   default — anything on the local host already has full loopback access.
 * - Token configured: `Authorization: Bearer <token>` must match.
 * - WebSocket upgrades cannot set headers from the browser, so a `?token=…`
 *   query-string fallback is accepted.
 *
 * The caller short-circuits `/config` so unauthenticated clients can discover
 * whether a token is required before attempting to authenticate.
 */
export function isAuthorized(req: Request): boolean {
  if (!CHANNEL_TOKEN) return true;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (bearer && bearer === CHANNEL_TOKEN) return true;
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.get("token") ?? "";
    return qs !== "" && qs === CHANNEL_TOKEN;
  } catch {
    return false;
  }
}

// ---- MCP server (stdio) --------------------------------------------------

const mcp = new Server(
  { name: "intelli-claw-channel", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
      experimental: {
        "claude/channel": {},
        // Opt in to v2.1.81+ permission relay — Claude forwards tool-approval
        // prompts to this channel so the user can answer from the UI.
        "claude/channel/permission": {},
      },
    },
    instructions:
      `The sender reads the intelli-claw UI, not this session. Anything you want them to see must go through the reply tool — your transcript output never reaches the UI.\n\n` +
      `Messages from the UI arrive as <channel source="intelli-claw" session_id="..." message_id="..." user="...">. If the tag has a file_path attribute, Read that file — it is an upload from the UI. Reply with the reply tool. UI is at http://${HOST}:${PORT}.\n\n` +
      `The UI supports multiple named sessions (main, scout, biz-ops, etc). The inbound tag's session_id tells you which conversation the user is in. Use session_switch to acknowledge a session change the user requested, and scope your tone/tools to match.`,
  },
);

/**
 * Build a permission-verdict notification payload. Pure so tests can assert
 * the shape without needing a live MCP transport.
 */
export function buildPermissionVerdict(
  request_id: string,
  behavior: "allow" | "deny",
): Parameters<typeof mcp.notification>[0] {
  return {
    method: "notifications/claude/channel/permission",
    params: { request_id, behavior },
  };
}

/**
 * Auto-approve every tool-approval prompt forwarded over the channel.
 *
 * The v2.1.81+ `claude/channel/permission` capability is still advertised so
 * Claude Code keeps routing prompts through this channel instead of the
 * terminal dialog. We short-circuit every request with an immediate "allow"
 * and never surface a Pending card to the UI — user explicitly opted into
 * skip-all-permissions behavior.
 *
 * Keep `pendingPermissions` + `resolvePermissionVerdict` exported for tests
 * and for any future opt-in flow; they're no-ops in the auto-approve path.
 */
mcp.setNotificationHandler(
  z.object({
    method: z.literal("notifications/claude/channel/permission_request"),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  }),
  async ({ params }) => {
    const verdict = buildPermissionVerdict(params.request_id, "allow");
    await mcp.notification(verdict).catch(() => {});
    broadcast({
      type: "permission_verdict",
      request_id: params.request_id,
      behavior: "allow",
    });
  },
);

export function resolvePermissionVerdict(
  request_id: string,
  behavior: "allow" | "deny",
): boolean {
  if (!pendingPermissions.has(request_id)) return false;
  pendingPermissions.delete(request_id);
  void mcp
    .notification(buildPermissionVerdict(request_id, behavior))
    .catch(() => {});
  broadcast({ type: "permission_verdict", request_id, behavior });
  return true;
}

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

/**
 * Handle inbound text from the UI. If the text is a permission reply
 * ("yes <id>" / "no <id>") it short-circuits to resolve the pending request;
 * otherwise it's broadcast as a chat message and delivered to Claude.
 * Returns `'permission'` or `'chat'` for the caller to log / branch on.
 */
export function handleInboundText(args: {
  id: string;
  text: string;
  sessionId: string;
}): "permission" | "chat" {
  const verdict = parsePermissionReply(args.text);
  if (verdict && resolvePermissionVerdict(verdict.request_id, verdict.behavior)) {
    return "permission";
  }
  broadcast({
    type: "msg",
    id: args.id,
    from: "user",
    text: args.text,
    ts: Date.now(),
    sessionId: args.sessionId,
  });
  deliverNotification(args.id, args.sessionId, args.text);
  return "chat";
}

export interface StartHttpServerOptions {
  port?: number;
  hostname?: string;
}

export async function startHttpServer(
  opts: StartHttpServerOptions = {},
): Promise<ReturnType<typeof Bun.serve>> {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

  // Only claim the lock when we're actually binding the real port. Test
  // harnesses pass port=0 and don't need the cross-process coordination.
  const effectivePort = opts.port ?? PORT;
  if (effectivePort !== 0) {
    claimPidLock(STATE_DIR, effectivePort);
  }

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

      // /config is always accessible so clients can discover auth requirements
      // before attempting to authenticate.
      if (url.pathname === "/" || url.pathname === "/config") {
        const body = JSON.stringify({
          status: "ok",
          plugin: "intelli-claw-channel",
          version: "0.1.0",
          port: PORT,
          activeSessionId,
          tools: ["reply", "edit_message", "session_switch"],
          authRequired: CHANNEL_TOKEN !== "",
          mode: IS_LAN_MODE ? "lan" : "loopback",
        });
        return new Response(body, {
          headers: { ...baseHeaders, "content-type": "application/json" },
        });
      }

      if (!isAuthorized(req)) {
        return new Response("unauthorized", {
          status: 401,
          headers: {
            ...baseHeaders,
            "WWW-Authenticate": "Bearer realm=\"intelli-claw-channel\"",
          },
        });
      }

      if (url.pathname === "/sessions" && req.method === "GET") {
        // Resolution order:
        //  1) explicit `?cwd=…` (UI sends the project directory it cares about)
        //  2) INTELLI_CLAW_PROJECT_CWD env (for Electron-spawned sessions)
        //  3) the plugin's own process.cwd() — only useful when the user
        //     happened to launch claude from the same dir the plugin lives in
        const queryCwd = url.searchParams.get("cwd") || "";
        const envCwd = process.env.INTELLI_CLAW_PROJECT_CWD ?? "";
        const cwd = queryCwd || envCwd || process.cwd();
        const sessions = listSessionSummaries(cwd);
        return new Response(
          JSON.stringify({
            cwd,
            projectDir: claudeProjectDir(cwd),
            activeUuid: process.env.INTELLI_CLAW_SESSION_UUID ?? null,
            sessions,
          }),
          {
            headers: { ...baseHeaders, "content-type": "application/json" },
          },
        );
      }

      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400, headers: baseHeaders });
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
          handleInboundText(payload);
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
          handleInboundText({
            id: obj.id,
            text: obj.text.trim(),
            sessionId: obj.session_id || activeSessionId,
          });
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
  const mode = IS_LAN_MODE ? "lan" : "loopback";
  const auth = CHANNEL_TOKEN ? "bearer-token" : "none";
  process.stderr.write(
    `intelli-claw-channel: http://${HOST}:${PORT} (mode=${mode} auth=${auth})\n`,
  );
  if (IS_LAN_MODE && !CHANNEL_TOKEN) {
    process.stderr.write(
      "intelli-claw-channel: WARNING — LAN mode without INTELLI_CLAW_TOKEN. " +
        "Anyone on the network can talk to Claude. Set INTELLI_CLAW_TOKEN=<secret>.\n",
    );
  }
}
