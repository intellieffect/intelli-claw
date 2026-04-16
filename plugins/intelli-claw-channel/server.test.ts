/**
 * Unit + contract tests for the intelli-claw-channel MCP server.
 *
 * Run: `bun test` from this package.
 */

import { describe, it, expect, beforeEach, afterAll, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  mime,
  nextId,
  corsHeaders,
  assertSendable,
  buildNotificationPayload,
  buildPermissionVerdict,
  readSendPayload,
  startHttpServer,
  parsePermissionReply,
  pendingPermissions,
  resolvePermissionVerdict,
  isAuthorized,
  extractText,
  looksLikeHookInjection,
  parseSessionHistory,
  HIDDEN_PREFIXES,
} from "./server";

// ---------- mime ----------

describe("mime", () => {
  it("maps known extensions", () => {
    expect(mime(".png")).toBe("image/png");
    expect(mime(".pdf")).toBe("application/pdf");
    expect(mime(".json")).toBe("application/json");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(mime(".xyz")).toBe("application/octet-stream");
    expect(mime("")).toBe("application/octet-stream");
  });
});

// ---------- nextId ----------

describe("nextId", () => {
  it("returns a monotonically unique id", () => {
    const a = nextId();
    const b = nextId();
    expect(a).toMatch(/^m\d+-\d+$/);
    expect(b).toMatch(/^m\d+-\d+$/);
    expect(a).not.toBe(b);
  });
});

// ---------- corsHeaders ----------

describe("corsHeaders", () => {
  it("allows Vite dev origins", () => {
    const h = corsHeaders("http://localhost:4000");
    expect(h["Access-Control-Allow-Origin"]).toBe("http://localhost:4000");
    expect(h["Vary"]).toBe("Origin");
  });

  it("allows Electron app:// origin", () => {
    const h = corsHeaders("app://./index.html");
    expect(h["Access-Control-Allow-Origin"]).toBe("app://./index.html");
  });

  it.each([
    "capacitor://localhost",
    "ionic://localhost",
    "exp://192.168.1.42:19000",
    "file:///Users/bruce/app/index.html",
  ])("allows mobile/native origin %s", (origin) => {
    const h = corsHeaders(origin);
    expect(h["Access-Control-Allow-Origin"]).toBe(origin);
  });

  it("advertises Authorization in Allow-Headers (for LAN bearer auth)", () => {
    const h = corsHeaders("http://localhost:4000");
    expect(h["Access-Control-Allow-Headers"]).toContain("Authorization");
  });

  it("omits the Allow-Origin header for disallowed origins", () => {
    const h = corsHeaders("http://evil.example");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("omits the Allow-Origin header for a null origin", () => {
    const h = corsHeaders(null);
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

// ---------- readSendPayload ----------

describe("readSendPayload", () => {
  it("accepts a well-formed body", () => {
    const p = readSendPayload({
      id: "u1",
      text: "hello",
      session_id: "scout",
    });
    expect(p).toEqual({ id: "u1", text: "hello", sessionId: "scout" });
  });

  it("defaults to the active session when session_id is omitted", () => {
    const p = readSendPayload({ id: "u1", text: "hello" });
    expect(p).not.toBeNull();
    expect(p?.sessionId).toBe("main");
  });

  it("rejects empty id", () => {
    expect(readSendPayload({ id: "", text: "hello" })).toBeNull();
  });

  it("rejects whitespace-only text", () => {
    expect(readSendPayload({ id: "u1", text: "   " })).toBeNull();
  });

  it("rejects non-object bodies", () => {
    expect(readSendPayload(null)).toBeNull();
    expect(readSendPayload("not-an-object")).toBeNull();
  });
});

// ---------- deliverNotification ----------

describe("buildNotificationPayload", () => {
  it("builds the Claude Code channel notification payload", () => {
    const payload = buildNotificationPayload("u1", "main", "hello world");
    expect(payload.method).toBe("notifications/claude/channel");
    const params = payload.params as { content: string; meta: Record<string, string> };
    expect(params.content).toBe("hello world");
    expect(params.meta.chat_id).toBe("web");
    expect(params.meta.session_id).toBe("main");
    expect(params.meta.message_id).toBe("u1");
    expect(params.meta.user).toBe("web");
    expect(params.meta.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(params.meta.file_path).toBeUndefined();
  });

  it("includes file_path in meta when a file is attached", () => {
    const payload = buildNotificationPayload("u2", "scout", "", {
      path: "/abs/inbox/foo.png",
      name: "foo.png",
    });
    const params = payload.params as { content: string; meta: Record<string, string> };
    expect(params.meta.file_path).toBe("/abs/inbox/foo.png");
  });

  it("uses a placeholder content when text is empty and a file is attached", () => {
    const payload = buildNotificationPayload("u3", "main", "", {
      path: "/abs/inbox/x.pdf",
      name: "x.pdf",
    });
    const params = payload.params as { content: string };
    expect(params.content).toBe("(x.pdf)");
  });

  it("emits only snake_case meta keys (hyphen keys would be dropped by Claude Code)", () => {
    const payload = buildNotificationPayload("u4", "main", "hello");
    const params = payload.params as { meta: Record<string, string> };
    for (const key of Object.keys(params.meta)) {
      expect(key).not.toContain("-");
    }
  });
});

// ---------- assertSendable ----------

describe("assertSendable (path traversal defense)", () => {
  const homeStateDir = join(
    process.env.HOME ?? tmpdir(),
    ".claude",
    "channels",
    "intelli-claw",
  );

  let workRoot: string;

  beforeEach(() => {
    // Ensure the real state dir exists so realpathSync resolves.
    mkdirSync(join(homeStateDir, "inbox"), { recursive: true });
    mkdirSync(join(homeStateDir, "outbox"), { recursive: true });
    workRoot = mkdtempSync(join(tmpdir(), "intelli-claw-test-"));
  });

  afterAll(() => {
    // Best-effort cleanup. Do not remove the home state dir — it may be live.
  });

  it("allows files outside the state directory", () => {
    const p = join(workRoot, "payload.txt");
    writeFileSync(p, "hi");
    expect(() => assertSendable(p)).not.toThrow();
    rmSync(p);
  });

  it("allows files inside inbox/", () => {
    const p = join(homeStateDir, "inbox", `test-${Date.now()}.txt`);
    writeFileSync(p, "hi");
    try {
      expect(() => assertSendable(p)).not.toThrow();
    } finally {
      rmSync(p);
    }
  });

  it("refuses files inside the state directory but outside inbox/", () => {
    const p = join(homeStateDir, `leak-${Date.now()}.txt`);
    writeFileSync(p, "secret");
    try {
      expect(() => assertSendable(p)).toThrow(/refusing to send channel state/);
    } finally {
      rmSync(p);
    }
  });

  it("refuses files inside outbox/ (outbox is written-to by the server, not read back)", () => {
    const p = join(homeStateDir, "outbox", `leak-${Date.now()}.txt`);
    writeFileSync(p, "secret");
    try {
      expect(() => assertSendable(p)).toThrow(/refusing to send channel state/);
    } finally {
      rmSync(p);
    }
  });
});

// ---------- HTTP + WS integration ----------

describe("HTTP server", () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let base: string;

  beforeEach(async () => {
    server = await startHttpServer({ port: 0, hostname: "127.0.0.1" });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(() => {
    server.stop(true);
  });

  it("GET /config returns plugin metadata", async () => {
    const res = await fetch(`${base}/config`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.plugin).toBe("intelli-claw-channel");
    expect(body.tools).toEqual(["reply", "edit_message", "session_switch"]);
    expect(typeof body.port).toBe("number");
  });

  it("OPTIONS preflight from an allowed origin includes CORS headers", async () => {
    const res = await fetch(`${base}/send`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:4000" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:4000",
    );
  });

  it("POST /send with a well-formed body broadcasts on WS", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const received: unknown[] = [];
    const opened = new Promise<void>((r) => ws.addEventListener("open", () => r()));
    ws.addEventListener("message", (e) => {
      received.push(JSON.parse(String(e.data)));
    });
    await opened;

    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "u1", text: "hello", session_id: "scout" }),
    });
    expect(res.status).toBe(204);

    await new Promise((r) => setTimeout(r, 50));
    ws.close();

    const msg = received.find(
      (m) => (m as { type: string }).type === "msg",
    ) as { from: string; text: string; sessionId: string } | undefined;
    expect(msg).toBeDefined();
    expect(msg?.from).toBe("user");
    expect(msg?.text).toBe("hello");
    expect(msg?.sessionId).toBe("scout");
  });

  it("POST /send with missing text returns 400", async () => {
    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "u1", text: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /files/../something rejects path traversal", async () => {
    const res = await fetch(`${base}/files/..%2Fsecret`);
    expect(res.status).toBe(400);
  });

  it("GET unknown route returns 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  it("/config advertises authRequired=false and mode=loopback by default", async () => {
    const res = await fetch(`${base}/config`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.authRequired).toBe(false);
    expect(body.mode).toBe("loopback");
  });
});

// ---------- Permission relay ----------

describe("parsePermissionReply", () => {
  it("accepts 'yes <id>' and 'no <id>' with 5-char ids", () => {
    expect(parsePermissionReply("yes abcde")).toEqual({
      request_id: "abcde",
      behavior: "allow",
    });
    expect(parsePermissionReply("no xyzab")).toEqual({
      request_id: "xyzab",
      behavior: "deny",
    });
  });

  it("accepts short 'y'/'n' aliases and is case-insensitive", () => {
    expect(parsePermissionReply("Y abcde")).toEqual({
      request_id: "abcde",
      behavior: "allow",
    });
    expect(parsePermissionReply("  N  ABCDE  ")).toEqual({
      request_id: "abcde",
      behavior: "deny",
    });
  });

  it("rejects ids containing 'l' (spec: [a-km-z])", () => {
    expect(parsePermissionReply("yes abcle")).toBeNull();
  });

  it("rejects the wrong id length", () => {
    expect(parsePermissionReply("yes abcd")).toBeNull();
    expect(parsePermissionReply("yes abcdef")).toBeNull();
  });

  it("rejects non-matching prefixes (no bare yes/no)", () => {
    expect(parsePermissionReply("maybe abcde")).toBeNull();
    expect(parsePermissionReply("yes")).toBeNull();
  });
});

// ---------- Bearer auth (LAN mode) ----------

describe("isAuthorized", () => {
  it("allows everything when no token is configured (loopback default)", () => {
    // CHANNEL_TOKEN is module-evaluated; the test binary runs without the
    // env var, so the function must behave as an open door here.
    const req = new Request("http://127.0.0.1:8790/send", { method: "POST" });
    expect(isAuthorized(req)).toBe(true);
  });
});

describe("buildPermissionVerdict (auto-approve wire shape)", () => {
  it("produces the allow payload Claude Code expects", () => {
    expect(buildPermissionVerdict("abcde", "allow")).toEqual({
      method: "notifications/claude/channel/permission",
      params: { request_id: "abcde", behavior: "allow" },
    });
  });

  it("produces the deny payload for completeness", () => {
    expect(buildPermissionVerdict("xyzab", "deny")).toEqual({
      method: "notifications/claude/channel/permission",
      params: { request_id: "xyzab", behavior: "deny" },
    });
  });
});

describe("resolvePermissionVerdict", () => {
  beforeEach(() => {
    pendingPermissions.clear();
  });

  it("returns false when no request is pending", () => {
    expect(resolvePermissionVerdict("abcde", "allow")).toBe(false);
  });

  it("consumes a pending request and returns true", () => {
    pendingPermissions.set("abcde", {
      request_id: "abcde",
      tool_name: "Bash",
      description: "run ls",
      input_preview: "ls -la",
    });
    expect(resolvePermissionVerdict("abcde", "deny")).toBe(true);
    expect(pendingPermissions.has("abcde")).toBe(false);
  });

  it("does not double-resolve", () => {
    pendingPermissions.set("abcde", {
      request_id: "abcde",
      tool_name: "Bash",
      description: "",
      input_preview: "",
    });
    expect(resolvePermissionVerdict("abcde", "allow")).toBe(true);
    expect(resolvePermissionVerdict("abcde", "allow")).toBe(false);
  });
});

// ---------- extractText ----------

describe("extractText", () => {
  it("returns string content as-is", () => {
    expect(extractText("hello world")).toBe("hello world");
  });

  it("joins array content text parts", () => {
    const content = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(extractText(content)).toBe("line 1\nline 2");
  });

  it("returns empty for non-text content", () => {
    expect(extractText(42)).toBe("");
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("skips non-text array parts", () => {
    const content = [
      { type: "image", url: "..." },
      { type: "text", text: "only this" },
    ];
    expect(extractText(content)).toBe("only this");
  });
});

// ---------- looksLikeHookInjection ----------

describe("looksLikeHookInjection", () => {
  it("detects system markers", () => {
    expect(looksLikeHookInjection("<system-reminder>some text")).toBe(true);
    expect(looksLikeHookInjection("<bash-stdout>output")).toBe(true);
    expect(looksLikeHookInjection("<user-prompt-submit-hook>...")).toBe(true);
  });

  it("passes normal text", () => {
    expect(looksLikeHookInjection("hello world")).toBe(false);
    expect(looksLikeHookInjection("fix the bug in server.ts")).toBe(false);
  });
});

// ---------- parseSessionHistory ----------

describe("parseSessionHistory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "history-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeJsonl(filename: string, entries: unknown[]): string {
    const path = join(tmpDir, filename);
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n"));
    return path;
  }

  it("extracts user and assistant turns", () => {
    const path = writeJsonl("test.jsonl", [
      { type: "user", userType: "external", message: { content: "hello" }, uuid: "u1", timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { content: "hi there" }, uuid: "a1", timestamp: "2025-01-01T00:00:01Z" },
    ]);
    const msgs = parseSessionHistory(path);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].from).toBe("user");
    expect(msgs[0].text).toBe("hello");
    expect(msgs[1].from).toBe("assistant");
    expect(msgs[1].text).toBe("hi there");
  });

  it("filters non-external userType", () => {
    const path = writeJsonl("test.jsonl", [
      { type: "user", userType: "internal", message: { content: "system msg" }, uuid: "u1" },
      { type: "user", userType: "external", message: { content: "real msg" }, uuid: "u2" },
    ]);
    const msgs = parseSessionHistory(path);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("real msg");
  });

  it("filters hook injections", () => {
    const path = writeJsonl("test.jsonl", [
      { type: "user", userType: "external", message: { content: "<system-reminder>injected" }, uuid: "u1" },
      { type: "user", userType: "external", message: { content: "normal message" }, uuid: "u2" },
    ]);
    const msgs = parseSessionHistory(path);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("normal message");
  });

  it("respects limit parameter", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      type: "user",
      userType: "external",
      message: { content: `msg ${i}` },
      uuid: `u${i}`,
      timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
    }));
    const path = writeJsonl("test.jsonl", entries);
    const msgs = parseSessionHistory(path, 3);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].text).toBe("msg 7"); // last 3
  });

  it("handles malformed JSONL lines gracefully", () => {
    const path = join(tmpDir, "bad.jsonl");
    writeFileSync(
      path,
      '{"type":"user","userType":"external","message":{"content":"ok"},"uuid":"u1"}\nnot json\n{"type":"assistant","message":{"content":"reply"},"uuid":"a1"}',
    );
    const msgs = parseSessionHistory(path);
    expect(msgs).toHaveLength(2);
  });

  it("returns empty array for missing file", () => {
    const msgs = parseSessionHistory("/nonexistent/path.jsonl");
    expect(msgs).toHaveLength(0);
  });

  it("handles array content format", () => {
    const path = writeJsonl("test.jsonl", [
      { type: "assistant", message: { content: [{ type: "text", text: "part 1" }, { type: "text", text: "part 2" }] }, uuid: "a1" },
    ]);
    const msgs = parseSessionHistory(path);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("part 1\npart 2");
  });
});

// ---------- HTTP /sessions/:uuid/history ----------

describe("HTTP /sessions/:uuid/history", () => {
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let base: string;

  beforeEach(async () => {
    server = await startHttpServer({ port: 0, hostname: "127.0.0.1" });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(() => {
    server.stop(true);
  });

  it("GET /sessions/:uuid/history returns 404 for missing session", async () => {
    const res = await fetch(`${base}/sessions/nonexistent-uuid/history`);
    expect(res.status).toBe(404);
  });
});
