/**
 * SessionManager — owns Claude Code subprocess lifecycle.
 *
 * One PTY-backed `claude` per logical session. Each session is allocated a
 * distinct port from `PORT_POOL_BASE`+, so the loopback channel plugin spawned
 * by that Claude session listens on its own port. The renderer then points a
 * `ChannelProvider` at `http://127.0.0.1:<port>` to talk to that session.
 *
 * Why PTY (not `child_process.spawn` with `pipe`):
 *   `claude` is a TUI. Without a TTY it sees stdin EOF immediately and exits,
 *   which kills the channel plugin subprocess as well. `node-pty` gives the
 *   subprocess a pseudo-terminal so it stays alive in the background, and we
 *   can keep the user from ever seeing it (no Terminal.app window).
 */

import { spawn as ptySpawn, type IPty } from "node-pty";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLAUDE_BIN_CANDIDATES = [
  join(homedir(), ".claude", "local", "claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

function resolveClaudeBin(): string {
  for (const c of CLAUDE_BIN_CANDIDATES) {
    if (existsSync(c)) return c;
  }
  // Fall back to PATH lookup (will fail loudly if missing).
  return "claude";
}

const CLAUDE_BIN = resolveClaudeBin();

const PORT_POOL_BASE = 8790;
const PORT_POOL_MAX = 8830;

const MARKETPLACE_PLUGIN = "plugin:intelli-claw-channel@intelli-claw";

export interface SessionInfo {
  /** Internal handle assigned by the manager (also the port number). */
  port: number;
  /** Claude Code session UUID this PTY is resuming, if any. */
  uuid: string | null;
  /** Project cwd the session was started in. */
  cwd: string;
  /** PID of the wrapper PTY (the `claude` process). */
  pid: number;
  /** Wall-clock ms when the session started. */
  startedAt: number;
}

interface PoolEntry extends SessionInfo {
  pty: IPty;
  output: string;
}

export class SessionManager {
  private pool = new Map<number, PoolEntry>();
  private uuidIndex = new Map<string, number>();
  private listeners = new Set<(snapshot: SessionInfo[]) => void>();

  list(): SessionInfo[] {
    return [...this.pool.values()].map((p) => ({
      port: p.port,
      uuid: p.uuid,
      cwd: p.cwd,
      pid: p.pid,
      startedAt: p.startedAt,
    }));
  }

  findByUuid(uuid: string): SessionInfo | null {
    const port = this.uuidIndex.get(uuid);
    if (!port) return null;
    const entry = this.pool.get(port);
    return entry ? entry : null;
  }

  onChange(cb: (snapshot: SessionInfo[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Start (or attach to existing) a session for the given uuid+cwd. Returns
   * the loopback URL the renderer should point its ChannelProvider at.
   */
  spawn(opts: { uuid?: string; cwd: string }): SessionInfo {
    const cwd = opts.cwd;
    const wantUuid = opts.uuid ?? null;

    if (wantUuid) {
      const existing = this.findByUuid(wantUuid);
      if (existing) return existing;
    }

    const port = this.allocatePort();
    const args = [
      "--dangerously-load-development-channels",
      MARKETPLACE_PLUGIN,
    ];
    if (wantUuid) {
      args.unshift("-r", wantUuid);
    }

    // GUI Electron processes don't inherit the user's interactive shell PATH,
    // so prepend the typical macOS dev locations (`bun`, `claude`, brew bins)
    // to whatever the OS handed us.
    const augmentedPath = [
      `${homedir()}/.bun/bin`,
      `${homedir()}/.claude/local`,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.PATH ?? "",
    ]
      .filter(Boolean)
      .join(":");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: augmentedPath,
      INTELLI_CLAW_PORT: String(port),
      INTELLI_CLAW_PROJECT_CWD: cwd,
      ...(wantUuid ? { INTELLI_CLAW_SESSION_UUID: wantUuid } : {}),
      // Force a UTF-8 locale; bare Electron envs sometimes lack it and
      // claude's TUI bails out trying to render.
      LANG: process.env.LANG ?? "en_US.UTF-8",
    };

    console.log(
      `[session-manager] spawning ${CLAUDE_BIN} ${args.join(" ")} ` +
        `port=${port} cwd=${cwd} uuid=${wantUuid ?? "(new)"}`,
    );

    const pty = ptySpawn(CLAUDE_BIN, args, {
      name: "xterm-256color",
      cwd,
      env: env as Record<string, string>,
      cols: 120,
      rows: 30,
    });

    const entry: PoolEntry = {
      port,
      uuid: wantUuid,
      cwd,
      pid: pty.pid,
      startedAt: Date.now(),
      pty,
      output: "",
    };

    pty.onData((data) => {
      // Keep a small ring buffer for debugging; don't grow unbounded.
      entry.output = (entry.output + data).slice(-32_000);
      // Also stream a stripped preview to main-process stdout so a CLI launch
      // (`/Applications/iClaw.app/Contents/MacOS/iClaw`) shows what the
      // hidden TUI is doing. Strip ANSI to keep noise low.
      const clean = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trim();
      if (clean.length > 0 && clean.length < 200) {
        console.log(`[session port=${port}] ${clean}`);
      }
    });
    pty.onExit(({ exitCode }) => {
      console.log(
        `[session-manager] pty exit port=${port} pid=${entry.pid} code=${exitCode}`,
      );
      this.pool.delete(port);
      if (entry.uuid) this.uuidIndex.delete(entry.uuid);
      this.notify();
    });

    this.pool.set(port, entry);
    if (wantUuid) this.uuidIndex.set(wantUuid, port);
    this.notify();
    return entry;
  }

  /** Stop a session by port. Sends SIGTERM via PTY; falls back to kill(). */
  stop(port: number): void {
    const entry = this.pool.get(port);
    if (!entry) return;
    try {
      entry.pty.kill("SIGTERM");
    } catch {
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  shutdown(): void {
    for (const port of [...this.pool.keys()]) this.stop(port);
  }

  /** Returns the first untaken port in the pool. */
  private allocatePort(): number {
    for (let p = PORT_POOL_BASE; p <= PORT_POOL_MAX; p++) {
      if (!this.pool.has(p)) return p;
    }
    throw new Error(
      `intelli-claw SessionManager: no free ports in [${PORT_POOL_BASE}-${PORT_POOL_MAX}]`,
    );
  }

  private notify(): void {
    const snap = this.list();
    for (const cb of this.listeners) {
      try {
        cb(snap);
      } catch (err) {
        console.error("[session-manager] listener error:", err);
      }
    }
  }
}

export function getClaudeBinPath(): string {
  return CLAUDE_BIN;
}
