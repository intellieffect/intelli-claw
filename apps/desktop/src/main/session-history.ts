/**
 * Parse a Claude Code session transcript (`~/.claude/projects/<escaped-cwd>/<uuid>.jsonl`)
 * into the minimal `ChannelMsg` shape the renderer already renders.
 *
 * Only user/assistant turns are surfaced. Hook attachments, session-start
 * injections, tool_use parts, and other machinery are filtered out — they'd
 * just make the seed noisy.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HistoryMsg {
  id: string;
  from: "user" | "assistant";
  text: string;
  ts: number;
  sessionId: string;
}

export interface SessionHistoryRequest {
  uuid: string;
  cwd: string;
  /** Max messages to return (most recent N). Default 400. */
  limit?: number;
}

function escapeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const obj = p as { type?: string; text?: string };
    if (obj.type === "text" && typeof obj.text === "string") parts.push(obj.text);
  }
  return parts.join("\n");
}

// System-injected user turns we don't want on-screen. Hooks inject
// content that starts with a `<tag>` marker, and `<system-reminder>` /
// `<command-name>` wrappers are obvious examples.
const HIDDEN_PREFIXES = [
  "<system-reminder>",
  "<command-name>",
  "<command-args>",
  "<local-command-stdout>",
  "<command-stdout>",
  "<bash-stdout>",
  "<bash-stderr>",
  "<user-prompt-submit-hook>",
];

function looksLikeHookInjection(text: string): boolean {
  const trimmed = text.trimStart();
  return HIDDEN_PREFIXES.some((p) => trimmed.startsWith(p));
}

export function loadSessionHistory(req: SessionHistoryRequest): HistoryMsg[] {
  const limit = req.limit ?? 400;
  const path = join(
    homedir(),
    ".claude",
    "projects",
    escapeCwd(req.cwd),
    `${req.uuid}.jsonl`,
  );
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const msgs: HistoryMsg[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = entry.type as string | undefined;
    const from: "user" | "assistant" | null =
      type === "user" ? "user" : type === "assistant" ? "assistant" : null;
    if (!from) continue;

    // Skip synthetic user turns (internal prompts pushed by the CLI).
    if (from === "user") {
      const userType = entry.userType as string | undefined;
      if (userType && userType !== "external") continue;
    }

    const message = entry.message as Record<string, unknown> | undefined;
    const text = extractText(message?.content ?? "").trim();
    if (!text) continue;
    if (looksLikeHookInjection(text)) continue;

    const uuid = typeof entry.uuid === "string" ? entry.uuid : `hist-${msgs.length}`;
    const timestamp = entry.timestamp as string | undefined;
    const ts = timestamp ? Date.parse(timestamp) || Date.now() : Date.now();

    msgs.push({ id: uuid, from, text, ts, sessionId: "main" });
  }
  return msgs.slice(-limit);
}
