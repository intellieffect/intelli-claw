/**
 * Phase 2-A: channel module unit + contract tests.
 *
 * Covers the pure helpers and the fetch-backed HTTP methods of ChannelClient.
 * WebSocket behavior is exercised end-to-end by the plugin's own Bun tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ChannelClient,
  parseChannelWire,
  nextClientId,
  type ChannelWire,
} from "@intelli-claw/shared/channel";

describe("parseChannelWire", () => {
  it("parses valid msg frames", () => {
    const raw = JSON.stringify({
      type: "msg",
      id: "m1",
      from: "assistant",
      text: "hi",
      ts: 1,
      sessionId: "main",
    });
    const out = parseChannelWire(raw) as ChannelWire | null;
    expect(out?.type).toBe("msg");
  });

  it("returns null for malformed JSON", () => {
    expect(parseChannelWire("not json")).toBeNull();
  });

  it("returns null when the type key is missing", () => {
    expect(parseChannelWire(JSON.stringify({ id: "m1" }))).toBeNull();
  });
});

describe("nextClientId", () => {
  it("returns ids matching the u<ts>-<rand> pattern", () => {
    const id = nextClientId();
    expect(id).toMatch(/^u\d+-[a-z0-9]+$/);
  });

  it("produces unique ids across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextClientId()));
    expect(ids.size).toBe(50);
  });
});

describe("ChannelClient fetch methods", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("fetchInfo() GETs /config and returns JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "ok",
          plugin: "intelli-claw-channel",
          version: "0.1.0",
          port: 8790,
          activeSessionId: "main",
          tools: ["reply"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const c = new ChannelClient({ url: "http://127.0.0.1:8790" });
    const info = await c.fetchInfo();

    expect(info.plugin).toBe("intelli-claw-channel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [req] = fetchMock.mock.calls[0];
    expect(String(req)).toContain("/config");
  });

  it("send() POSTs JSON to /send and maps session_id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const c = new ChannelClient({ url: "http://127.0.0.1:8790" });

    await c.send({ id: "u1", text: "hello", sessionId: "scout" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ id: "u1", text: "hello", session_id: "scout" });
  });

  it("send() throws when the server returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    const c = new ChannelClient({ url: "http://127.0.0.1:8790" });
    await expect(
      c.send({ id: "u1", text: "hi", sessionId: "main" }),
    ).rejects.toThrow(/\/send 400/);
  });

  it("upload() POSTs a FormData body to /upload", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const c = new ChannelClient({ url: "http://127.0.0.1:8790" });

    const file = new File(["payload"], "note.txt", { type: "text/plain" });
    await c.upload({ id: "u2", text: "", file, sessionId: "main" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("id")).toBe("u2");
    expect(form.get("session_id")).toBe("main");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("attaches the Bearer header when a token is configured (LAN mode)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "ok",
          plugin: "intelli-claw-channel",
          version: "0.1.0",
          port: 8790,
          activeSessionId: "main",
          tools: [],
        }),
        { status: 200 },
      ),
    );
    const c = new ChannelClient({ url: "http://10.0.0.5:8790", token: "secret" });
    await c.fetchInfo();
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
  });
});
